/**
 * AI 处理管线 Hook
 * 管理检测→OCR→翻译→修复→渲染的全流程逻辑
 *
 * BUG FIX P1: 使用统一坐标工具 coords.ts 进行像素→百分比转换，
 * 强制要求 pageDimensions 有效时才进行转换，杜绝硬编码默认值 800×1100 导致的错位。
 * BUG FIX P2: OCR 步骤确保传入原始图像 URL（无缩放参数），保证识别质量。
 * P0 FIX: 全链路 AbortController 请求中断 + 递增重试 + 竞态保护
 */
import { useCallback, useRef } from 'react';
import { App } from 'antd';
import { pageApi } from '@/services/page';
import { useEditorStore } from '@/stores/editorStore';
import type { TextRegion } from '@/types';
import {
  normalizeDetectRegion,
  isValidDimensions,
  getPageDimensions,
  type PageDimensions,
} from '@/utils/coords';

/** P0 FIX: 重试配置 — 核心操作失败后自动重试，间隔递增 */
const RETRY_CONFIG = {
  maxRetries: 2,          // 最大重试次数
  baseDelayMs: 1000,      // 基础延迟 1s
  backoffMultiplier: 2,   // 指数退避倍数
};

/** P0 FIX: 判断错误是否可重试（网络、超时、服务端繁忙） */
function isRetryableError(err: any): boolean {
  const code = (err as any)?.code;
  const status = err?.response?.status || err?.status || 0;
  // 可重试: 网络错误、超时、服务器繁忙、取消
  if (code === 'ERR_NETWORK_CHANGED' || code === 'ERR_NETWORK' || code === 'ECONNABORTED') return true;
  if (status === 429 || status === 500 || status === 502 || status === 503) return true;
  // 取消错误不可重试
  if (code === 'ERR_CANCELED' || err?.name === 'CanceledError') return false;
  // 404 不可重试
  if (status === 404) return false;
  return false;
}

interface UseAIPipelineOptions {
  currentPageId: string | null;
  projectSourceLang?: string;
  defaultTargetLang?: string;
  /** BUG FIX P1: 直接传递 currentPageData 而非提取的 width/height，
   *  避免闭包捕获到 undefined 导致坐标转换使用错误默认值 */
  currentPageData: any | null;
  /** 设置 regions 的回调 */
  setRegions: (regions: TextRegion[]) => void;
  /** 更新 currentPageData.processed_url */
  setProcessedUrl: (url: string) => void;
}

export function useAIPipeline({
  currentPageId,
  projectSourceLang,
  defaultTargetLang = 'zh-CN',
  currentPageData,
  setRegions,
  setProcessedUrl,
}: UseAIPipelineOptions) {
  const { message } = App.useApp();
  // P0 FIX: setProcessing 现在接受 pageId 作为第一个参数
  const setProcessingRaw = useEditorStore((s) => s.setProcessing);
  const setActiveStep = useEditorStore((s) => s.setActiveStep);
  /** P0 FIX: 绑定当前 pageId 的处理状态设置器 */
  const setProcessing = useCallback(
    (isProcessing: boolean, step?: string | null, error?: string | null) => {
      if (currentPageId) {
        setProcessingRaw(currentPageId, isProcessing, step, error);
      }
    },
    [currentPageId, setProcessingRaw]
  );

  // BUG FIX P1: 使用 ref 保持对最新 pageData 的引用，避免 useCallback 闭包陈旧
  const pageDataRef = useRef(currentPageData);
  pageDataRef.current = currentPageData;

  // P0 FIX: AbortController + 请求队列管理
  const abortControllerRef = useRef<AbortController | null>(null);
  const pipelineGenerationRef = useRef(0);
  const isProcessingRef = useRef(false);
  const queueRef = useRef<Array<{ type: 'auto' | 'retry'; stepKey?: string; resolve: () => void }>>([]);

  /** 取消当前管线 */
  const cancelPipeline = useCallback((expectedGeneration?: number) => {
    const currentGen = pipelineGenerationRef.current;
    if (expectedGeneration != null && expectedGeneration !== currentGen) {
      return;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setProcessing(false);
    }
  }, [setProcessing]);

  /** 处理队列中的下一个任务 */
  const processQueue = useCallback(() => {
    if (queueRef.current.length > 0) {
      const next = queueRef.current.shift()!;
      message.info({ content: `队列中还有 ${queueRef.current.length + 1} 个任务，开始执行下一个`, key: 'auto-translate', duration: 2 });
      next.resolve();
    }
  }, [message]);

  /** 创建新管线 AbortController；如果正在处理则入队 */
  const beginPipeline = useCallback((): { controller: AbortController; signal: AbortSignal; generation: number } | null => {
    if (isProcessingRef.current) {
      return null;
    }
    pipelineGenerationRef.current += 1;
    const generation = pipelineGenerationRef.current;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    return { controller, signal: controller.signal, generation };
  }, []);

  const ALL_STEPS = ['detect', 'ocr', 'translate', 'inpaint', 'render'] as const;

  const STEP_LABELS: Record<string, string> = {
    detect: '文字检测',
    ocr: 'OCR 识别',
    translate: '翻译',
    inpaint: '背景修图',
    render: '文字渲染',
  };

  /** P0 FIX: 检查 OCR 结果是否有效（至少有1个区域有非空文本） */
  const hasValidOcrResults = useCallback((resData: any): boolean => {
    const ocrResults = resData?.results || resData?.regions || [];
    if (!ocrResults.length) return false;
    const textCount = ocrResults.filter((r: any) => (r.text || '').trim()).length;
    return textCount > 0;
  }, []);

  const stepFns = useCallback(
    (pageId: string, signal: AbortSignal): Record<string, () => Promise<any>> => ({
      detect: () => pageApi.detectRegions(pageId, signal, projectSourceLang),
      // BUG FIX P2: 确保传入原文语言，后端据此选择正确的 Tesseract 语言包
      ocr: () => pageApi.runOCR(pageId, projectSourceLang || undefined, signal),
      translate: () =>
        pageApi.translate(pageId, { target_lang: defaultTargetLang }, signal),
      inpaint: () => pageApi.inpaint(pageId, 'lama', signal),
      render: () => {
        const currentRegions = useEditorStore.getState().regions;
        const renderRegions = currentRegions
          .filter((r: any) => r.translated_text)
          .map((r: any) => ({
            region_id: r.region_id,
            translated_text: r.translated_text,
            font_id: r.style_config?.font_id,
            font_size: r.style_config?.font_size,
            font_family: r.style_config?.font_family,
            font_color: r.style_config?.color,
            alignment: r.style_config?.text_align,
            line_spacing: r.style_config?.line_height,
          }));
        return pageApi.render(pageId, renderRegions.length > 0 ? renderRegions : undefined, signal);
      },
    }),
    [projectSourceLang, defaultTargetLang]
  );

  /**
   * BUG FIX P1: 获取当前有效的页面尺寸，若无效则拒绝操作
   * 不再使用 toEditorRegion 的硬编码默认值 800×1100
   */
  const getSafeDimensions = useCallback((): PageDimensions => {
    const dims = getPageDimensions(pageDataRef.current);
    if (!isValidDimensions(dims)) {
      throw new Error(
        '页面尺寸数据未加载或无效，无法进行坐标转换。请等待页面数据加载完成后再操作。'
      );
    }
    return dims;
  }, []);

  /** 处理单个步骤的增量更新 */
  const applyStepResult = useCallback(
    (step: string, resData: any, pageId: string) => {
      if (step === 'detect' && resData?.regions) {
        // BUG FIX P1: 使用统一坐标工具 + 实时获取的页面尺寸进行转换
        let dims: PageDimensions;
        try {
          dims = getSafeDimensions();
        } catch (err: any) {
          console.error('[useAIPipeline] detect 坐标转换失败:', err.message);
          message.warning({ content: err.message, key: 'auto-translate', duration: 3 });
          return;
        }

        const detected = resData.regions.map((r: any) => {
          const normalized = normalizeDetectRegion({
            ...r,
            page_id: pageId,
            is_locked: r.is_locked ?? false,
            sort_order: r.sort_order ?? 0,
            created_at: r.created_at || new Date().toISOString(),
            updated_at: r.updated_at || new Date().toISOString(),
          }, dims);
          return normalized;
        });
        setRegions(detected as any);
      }
      if (step === 'ocr' && (resData?.results || resData?.regions)) {
        const ocrResults = resData.results || resData.regions;
        setRegions(
          (useEditorStore.getState().regions as any[]).map((r: any) => {
            const m = ocrResults.find((o: any) => o.region_id === r.region_id);
            return m
              ? {
                  ...r,
                  original_text: m.text || r.original_text,
                  confidence: m.confidence ?? r.confidence,
                  // P0: 透传字符级置信度给前端显示
                  char_confidences: m.char_confidences ?? r.char_confidences,
                }
              : r;
          })
        );
      }
      if (step === 'translate' && resData?.regions) {
        const transResults = resData.regions;
        setRegions(
          (useEditorStore.getState().regions as any[]).map((r: any) => {
            const m = transResults.find((t: any) => t.region_id === r.region_id);
            return m ? { ...r, translated_text: m.translated_text || r.translated_text } : r;
          })
        );
      }
      if ((step === 'inpaint' || step === 'render') && (resData?.result_url || resData?.processed_url)) {
        setProcessedUrl(resData.result_url || resData.processed_url);
      }
    },
    [setRegions, setProcessedUrl, getSafeDimensions]
  );

  /**
   * P0 FIX: 带重试的单个步骤执行器
   * 单次失败后自动重试 1-2 次，间隔递增
   */
  const executeStepWithRetry = useCallback(async (
    stepFn: () => Promise<any>,
    stepName: string,
    signal: AbortSignal,
  ): Promise<any> => {
    let lastError: any = null;
    for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
      // 检查是否已被取消
      if (signal.aborted) {
        throw new Error('请求已被取消');
      }
      try {
        const res = await stepFn();
        return res;
      } catch (err: any) {
        lastError = err;
        // 取消错误直接抛出，不重试
        if (
          (err as any)?.code === 'ERR_CANCELED' ||
          err?.name === 'CanceledError' ||
          signal.aborted
        ) {
          throw err;
        }
        // 不可重试的错误直接失败
        if (!isRetryableError(err)) {
          throw err;
        }
        // 最后一次尝试也失败，抛出
        if (attempt >= RETRY_CONFIG.maxRetries) {
          throw err;
        }
        // 重试前等待递增间隔
        const delay = RETRY_CONFIG.baseDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt);
        console.log(`[useAIPipeline] ${stepName} 失败，${delay}ms 后第 ${attempt + 1} 次重试...`);
        message.loading({
          content: `${stepName} 失败，${(delay / 1000).toFixed(0)}秒后重试...`,
          key: 'auto-translate',
          duration: delay / 1000,
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
        // 重试前再次检查是否被取消
        if (signal.aborted) {
          throw new Error('请求已被取消');
        }
      }
    }
    throw lastError;
  }, [message]);

  /** 一键翻译：从头执行全流程 */
  const autoTranslate = useCallback(async () => {
    if (!currentPageId) {
      message.warning({ content: '请先在左侧选择要翻译的页面', key: 'auto-translate', duration: 3 });
      return { failedStep: 'detect', errorMessage: '未选择页面' };
    }

    const pipeline = beginPipeline();
    if (!pipeline) {
      return new Promise<{ failedStep: string | null; errorMessage: string | null }>((resolve) => {
        queueRef.current.push({ type: 'auto', resolve: () => {
          autoTranslate().then(resolve);
        }});
        message.info({ content: `当前有任务处理中，一键翻译已加入队列（队列长度: ${queueRef.current.length}）`, key: 'auto-translate', duration: 3 });
      });
    }
    const { signal, generation } = pipeline;
    isProcessingRef.current = true;

    // BUG FIX P1: 启动前验证页面尺寸是否就绪
    try {
      getSafeDimensions();
    } catch (err: any) {
      isProcessingRef.current = false;
      message.warning({ content: '页面数据尚未加载完成，请稍后再试', key: 'auto-translate', duration: 3 });
      return { failedStep: 'detect', errorMessage: err.message };
    }

    setProcessing(true, 'detect');
    message.loading({ content: `${STEP_LABELS.detect}中 (1/${ALL_STEPS.length})...`, key: 'auto-translate', duration: 0 });

    const fns = stepFns(currentPageId, signal);
    let failedStep: string | null = null;
    let errorMsg: string | null = null;

    for (let stepIndex = 0; stepIndex < ALL_STEPS.length; stepIndex++) {
      const step = ALL_STEPS[stepIndex];
      // 竞态保护：页面切换或新管线启动后放弃当前循环
      if (generation !== pipelineGenerationRef.current) {
        console.log(`[useAIPipeline] stale pipeline generation, aborting at ${step}`);
        isProcessingRef.current = false;
        setProcessing(false);
        processQueue();
        return { failedStep: null, errorMessage: null };
      }
      // P0 FIX: 每步前检查是否已取消
      if (signal.aborted) {
        console.log(`[useAIPipeline] pipeline aborted before step ${step}`);
        isProcessingRef.current = false;
        setProcessing(false);
        processQueue();
        return { failedStep: null, errorMessage: null };
      }

      setActiveStep(step as any);
      setProcessing(true, step);
      message.loading({
        content: `${STEP_LABELS[step] || step}中 (${stepIndex + 1}/${ALL_STEPS.length})...`,
        key: 'auto-translate',
        duration: 0,
      });
      try {
        // P0 FIX: 使用带重试的执行器
        const res = await executeStepWithRetry(fns[step], step, signal);
        const resData = res.data?.data || res.data;
        applyStepResult(step, resData, currentPageId);
        if (step === 'detect') {
          const count = resData?.regions?.length || resData?.detected_count || 0;
          message.success({ content: `检测到 ${count} 个文字区域`, key: 'auto-translate', duration: 2 });
        } else if (step === 'ocr') {
          // P0 FIX: 验证 OCR 是否识别出有效文本
          if (hasValidOcrResults(resData)) {
            const ocrResults = resData?.results || resData?.regions || [];
            const textCount = ocrResults.filter((r: any) => (r.text || '').trim()).length;
            message.success({ content: `OCR识别完成，${textCount}/${ocrResults.length}个区域识别成功`, key: 'auto-translate', duration: 3 });
          } else {
            // OCR 返回全部空文本 — 停止后续管线，提示用户
            setProcessing(false);
            message.error({
              content: 'OCR识别返回空文本，无法继续翻译。请检查：1) Tesseract语言包是否已安装 2) 图片是否包含可识别文字',
              key: 'auto-translate',
              duration: 8,
            });
            return { failedStep: 'ocr', errorMessage: 'OCR识别返回空文本，管线已终止' };
          }
        } else if (step !== 'inpaint' && step !== 'render') {
          message.success({ content: `${step === 'translate' ? '翻译' : step}完成`, key: 'auto-translate', duration: 2 });
        } else if (step === 'render') {
          message.success({ content: '排版回填渲染完成', key: 'auto-translate', duration: 2 });
        }
      } catch (err: any) {
        // P0 FIX: 取消错误静默处理，不算失败
        if (
          (err as any)?.code === 'ERR_CANCELED' ||
          err?.name === 'CanceledError' ||
          err?.message === '请求已被取消'
        ) {
          console.log(`[useAIPipeline] step ${step} cancelled`);
          isProcessingRef.current = false;
          setProcessing(false);
          processQueue();
          return { failedStep: null, errorMessage: null };
        }
        const statusCode = err?.response?.status || err?.status || 0;
        failedStep = step;
        if (statusCode === 404) {
          errorMsg = `${step} 接口暂不可用`;
          message.warning({ content: `后端 ${step} 接口尚未就绪，请检查服务状态`, key: 'auto-translate' });
        } else {
          errorMsg = `${step} 执行失败: ${err?.message || '未知错误'}`;
          message.error({
            content: `${step} 失败（已重试${RETRY_CONFIG.maxRetries}次），可手动重试`,
            key: 'auto-translate',
            duration: 5,
          });
        }
        isProcessingRef.current = false;
        setProcessing(false);
        processQueue();
        return { failedStep, errorMessage: errorMsg };
      }
    }

    isProcessingRef.current = false;
    setProcessing(false);
    message.success({ content: '翻译完成！', key: 'auto-translate' });
    processQueue();
    return { failedStep: null, errorMessage: null };
  }, [currentPageId, stepFns, setProcessing, setActiveStep, applyStepResult, getSafeDimensions, beginPipeline, executeStepWithRetry, hasValidOcrResults, message, processQueue]);

  /** 单步骤重试（从指定步骤开始执行到结束） */
  const retryStep = useCallback(
    async (stepKey: string) => {
      if (!currentPageId) return;
      const startIdx = ALL_STEPS.indexOf(stepKey as any);
      if (startIdx === -1) return;

      const pipeline = beginPipeline();
      if (!pipeline) {
        return new Promise<{ failedStep: string | null; errorMessage: string | null }>((resolve) => {
          queueRef.current.push({ type: 'retry', stepKey, resolve: () => {
            retryStep(stepKey).then(resolve);
          }});
          message.info({ content: `当前有任务处理中，重试 ${stepKey} 已加入队列`, key: 'retry-step', duration: 3 });
        });
      }
      const { signal, generation } = pipeline;
      isProcessingRef.current = true;

      try {
        getSafeDimensions();
      } catch (err: any) {
        message.warning({ content: '页面数据尚未加载完成，请稍后再试', key: 'retry-step', duration: 3 });
        return { failedStep: stepKey, errorMessage: err.message };
      }

      message.loading({ content: '正在重试并继续...', key: 'retry-step', duration: 0 });
      setProcessing(true, stepKey);
      const fns = stepFns(currentPageId, signal);

      for (let i = startIdx; i < ALL_STEPS.length; i++) {
        const step = ALL_STEPS[i];
        if (generation !== pipelineGenerationRef.current) {
          setProcessing(false);
          return { failedStep: null, errorMessage: null };
        }
        // P0 FIX: 每步前检查是否已取消
        if (signal.aborted) {
          console.log(`[useAIPipeline] retryStep aborted before step ${step}`);
          setProcessing(false);
          return { failedStep: null, errorMessage: null };
        }

        setActiveStep(step as any);
        setProcessing(true, step);
        try {
          // P0 FIX: 使用带重试的执行器
          const res = await executeStepWithRetry(fns[step], step, signal);
          const resData = res.data?.data || res.data;
          applyStepResult(step, resData, currentPageId);

          // P0 FIX: OCR 步骤验证结果有效性
          if (step === 'ocr') {
            if (hasValidOcrResults(resData)) {
              const ocrResults = resData?.results || resData?.regions || [];
              const textCount = ocrResults.filter((r: any) => (r.text || '').trim()).length;
              message.success({ content: `OCR重试完成，${textCount}/${ocrResults.length}个区域识别成功`, key: 'retry-step', duration: 3 });
            } else {
              setProcessing(false);
              message.error({
                content: 'OCR重试仍返回空文本，请检查 Tesseract 语言包安装和图片质量',
                key: 'retry-step',
                duration: 8,
              });
              return { failedStep: 'ocr', errorMessage: 'OCR识别返回空文本' };
            }
          } else if (step === 'render') {
            message.success({ content: '排版回填渲染完成', key: 'retry-step', duration: 2 });
          }
        } catch (err: any) {
          // P0 FIX: 取消错误静默处理
          if (
            (err as any)?.code === 'ERR_CANCELED' ||
            err?.name === 'CanceledError' ||
            err?.message === '请求已被取消'
          ) {
            console.log(`[useAIPipeline] retryStep ${step} cancelled`);
            setProcessing(false);
            return { failedStep: null, errorMessage: null };
          }
          message.error({
            content: `${step} 失败（已重试${RETRY_CONFIG.maxRetries}次），可再次手动重试`,
            key: 'retry-step',
            duration: 5,
          });
          isProcessingRef.current = false;
          setProcessing(false);
          processQueue();
          return { failedStep: step, errorMessage: `${step} 失败: ${err?.message || '未知错误'}` };
        }
      }

      isProcessingRef.current = false;
      setProcessing(false);
      message.success({ content: '全部步骤完成！', key: 'retry-step' });
      processQueue();
      return { failedStep: null, errorMessage: null };
    },
    [currentPageId, stepFns, setProcessing, setActiveStep, applyStepResult, getSafeDimensions, beginPipeline, executeStepWithRetry, hasValidOcrResults, message, processQueue]
  );

  return {
    autoTranslate,
    retryStep,
    cancelPipeline,
    ALL_STEPS,
    stepFns,
  };
}
