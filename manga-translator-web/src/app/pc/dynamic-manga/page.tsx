'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Card, Button, Spin, Progress, Empty, App, Steps, Tag, Alert, Space, Tabs, Input } from 'antd';
import {
  Film, Play, Pause, Download, Wand2, Volume2, Music,
  AlertCircle, CheckCircle2, Loader2, Share2, FileVideo, Clock, Sparkles
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'next/navigation';
import { dynamicMangaApi, type DynamicMangaTask } from '@/services/audio';
import { useAuthStore } from '@/stores/authStore';

export default function DynamicMangaPage() {
  const { message } = App.useApp();
  const params = useParams();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const accessToken = useAuthStore((s) => s.accessToken);

  const [taskId, setTaskId] = useState<string | null>(null);
  const [chapterInput, setChapterInput] = useState('');
  const [options, setOptions] = useState({ add_audio: true, add_effects: true });
  const [videoBlobUrl, setVideoBlobUrl] = useState<string | null>(null);
  const [videoLoading, setVideoLoading] = useState(false);

  const chapterId =
    (params?.id as string) || searchParams.get('chapter_id') || chapterInput.trim();

  const { data: task, isLoading: taskLoading, refetch: refetchTask } = useQuery({
    queryKey: ['dynamic-manga', taskId],
    queryFn: async () => {
      if (!taskId) return null;
      const res = await dynamicMangaApi.getTaskStatus(taskId);
      return (res.data?.data || null) as DynamicMangaTask | null;
    },
    enabled: !!taskId,
    refetchInterval: taskId ? 3000 : false,
  });

  const generateMutation = useMutation({
    mutationFn: () => dynamicMangaApi.generate(chapterId, options),
    onSuccess: (res) => {
      setTaskId(res.data?.data?.task_id || null);
      message.success('动态漫画生成任务已启动');
    },
    onError: (err: Error) => message.error(err.message),
  });

  // 进度条模拟 & 状态判定
  const progress = task?.progress || 0;
  const isCompleted = task?.status === 'completed';
  const isProcessing = task?.status === 'processing' || task?.status === 'pending';
  const isFailed = task?.status === 'failed';

  // B7 fix: Fetch video with auth token and create blob URL for playback
  useEffect(() => {
    if (isCompleted && task?.video_url && !videoBlobUrl && !videoLoading) {
      setVideoLoading(true);
      const fetchVideo = async () => {
        try {
          const headers: Record<string, string> = {};
          if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
          const res = await fetch(task.video_url!, { headers });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          setVideoBlobUrl(url);
        } catch {
          // Fallback: try direct URL (may work with cookies)
          setVideoBlobUrl(task.video_url!);
        } finally {
          setVideoLoading(false);
        }
      };
      fetchVideo();
    }
    return () => {
      if (videoBlobUrl) URL.revokeObjectURL(videoBlobUrl);
    };
  }, [isCompleted, task?.video_url]);

  const handleGenerate = () => {
    if (!chapterId.trim()) {
      message.warning('请先输入章节 ID，或在作品详情页通过「生成动态漫画」进入');
      return;
    }
    generateMutation.mutate();
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="sticky top-0 z-10 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-900/30 flex items-center justify-center">
              <Film size={22} className="text-rose-600 dark:text-rose-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 dark:text-white">动态漫画</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                将静态漫画页面生成带配音和音效的动态视频
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
        {/* 生成面板 */}
        {!taskId && (
          <Card
            title={
              <span className="flex items-center gap-2">
                <Wand2 size={18} className="text-rose-500" />
                生成动态漫画
              </span>
            }
          >
            <div className="space-y-4 py-4">
              {!chapterId && (
                <>
                  <Alert
                    type="warning"
                    showIcon
                    message="尚未选择章节"
                    description="请输入章节 ID，或在作品详情页通过「生成动态漫画」进入。"
                  />
                  <div>
                    <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">章节 ID</label>
                    <Input
                      placeholder="输入 chapter_id"
                      value={chapterInput}
                      onChange={(e) => setChapterInput(e.target.value)}
                      data-testid="dynamic-manga-chapter-input"
                    />
                  </div>
                </>
              )}
              <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800">
                <span className="text-sm">添加角色配音</span>
                <Button
                  size="small"
                  type={options.add_audio ? 'primary' : 'default'}
                  icon={<Volume2 size={14} />}
                  onClick={() => setOptions({ ...options, add_audio: !options.add_audio })}
                >
                  {options.add_audio ? '已启用' : '已关闭'}
                </Button>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800">
                <span className="text-sm">添加场景音效</span>
                <Button
                  size="small"
                  type={options.add_effects ? 'primary' : 'default'}
                  icon={<Music size={14} />}
                  onClick={() => setOptions({ ...options, add_effects: !options.add_effects })}
                >
                  {options.add_effects ? '已启用' : '已关闭'}
                </Button>
              </div>

              <Alert
                message="预计生成时间"
                description={
                  <span>
                    根据章节页数，预计需要 <strong>30秒~2分钟</strong>。配音需提前在音频剧场中为角色配置语音。
                  </span>
                }
                type="info"
                showIcon
              />

              <Button
                type="primary"
                size="large"
                icon={<Film size={18} />}
                onClick={handleGenerate}
                loading={generateMutation.isPending}
                block
                className="h-12 text-lg"
              >
                开始生成动态漫画
              </Button>
            </div>
          </Card>
        )}

        {/* 生成进度 */}
        {taskId && (
          <Card
            title={
              <span className="flex items-center gap-2">
                {isProcessing ? <Loader2 size={18} className="text-blue-500 animate-spin" /> :
                 isCompleted ? <CheckCircle2 size={18} className="text-green-500" /> :
                 isFailed ? <AlertCircle size={18} className="text-red-500" /> :
                 <Film size={18} className="text-rose-500" />}
                动态漫画生成
              </span>
            }
          >
            <div className="py-6 space-y-6 text-center">
              {/* 步骤 */}
              <Steps
                current={
                  progress < 25 ? 0 :
                  progress < 50 ? 1 :
                  progress < 75 ? 2 :
                  progress < 100 ? 3 : 4
                }
                size="small"
                items={[
                  { title: '准备素材' },
                  { title: '配音合成' },
                  { title: '画面动效' },
                  { title: '合成视频' },
                  { title: '完成' },
                ]}
              />

              <Progress
                type="circle"
                percent={progress}
                status={isFailed ? 'exception' : isCompleted ? 'success' : 'active'}
                size={120}
              />

              <Space direction="vertical" size="small">
                <p className="text-sm font-medium">
                  {isProcessing && `正在处理... ${progress}%`}
                  {isCompleted && '生成完成！'}
                  {isFailed && '生成失败'}
                </p>
                {task?.error && (
                  <Tag color="red">{task.error}</Tag>
                )}
                {task?.duration && (
                  <Tag icon={<Clock size={12} />}>时长: {Math.round(task.duration)}秒</Tag>
                )}
              </Space>

              {isCompleted && task?.video_url && (
                <div className="space-y-4">
                  {videoLoading ? (
                    <div className="w-full aspect-video rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                      <Spin tip="加载视频中..." />
                    </div>
                  ) : videoBlobUrl ? (
                    <video
                      controls
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700"
                      src={videoBlobUrl}
                    />
                  ) : (
                    <video
                      controls
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700"
                      src={task.video_url}
                      crossOrigin="anonymous"
                    />
                  )}
                  <Space size="middle">
                    <Button type="primary" icon={<Download size={14} />} onClick={() => {
                      if (videoBlobUrl) {
                        const a = document.createElement('a');
                        a.href = videoBlobUrl;
                        a.download = 'dynamic-manga.mp4';
                        a.click();
                      } else if (task.video_url) {
                        window.open(task.video_url, '_blank');
                      }
                    }}>
                      下载视频
                    </Button>
                    <Button icon={<Share2 size={14} />}>分享</Button>
                    <Button icon={<Wand2 size={14} />} onClick={() => { setTaskId(null); setVideoBlobUrl(null); }}>
                      重新生成
                    </Button>
                  </Space>
                </div>
              )}

              {isFailed && (
                <Space>
                  <Button danger onClick={() => setTaskId(null)}>重新开始</Button>
                  <Button onClick={() => { setTaskId(null); generateMutation.mutate(); }}>重试</Button>
                </Space>
              )}
            </div>
          </Card>
        )}

        {/* 示例展示 */}
        {!taskId && !isProcessing && (
          <Card
            title={<span className="flex items-center gap-2"><FileVideo size={16} className="text-rose-500" />效果预览</span>}
          >
            <p className="text-xs text-slate-400 mb-4">以下是动态漫画的生成效果示例：</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 bg-gradient-to-br from-rose-50 to-purple-50 dark:from-rose-900/20 dark:to-purple-900/20 aspect-video flex items-center justify-center relative">
                <div className="absolute inset-0 bg-cover bg-center opacity-20" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'400\' height=\'225\'%3E%3Crect fill=\'%23e2e8f0\' width=\'400\' height=\'225\'/%3E%3Ctext x=\'200\' y=\'115\' text-anchor=\'middle\' fill=\'%2394a3b8\' font-size=\'14\'%3E原始漫画页%3C/text%3E%3C/svg%3E")' }} />
                <div className="relative text-center space-y-2 z-10">
                  <div className="w-12 h-12 mx-auto rounded-full bg-rose-100 dark:bg-rose-900/40 flex items-center justify-center">
                    <Play size={24} className="text-rose-500" />
                  </div>
                  <p className="text-sm font-medium text-slate-600 dark:text-slate-300">原页</p>
                  <p className="text-[10px] text-slate-400">静态漫画原始页面</p>
                </div>
              </div>
              <div className="rounded-lg overflow-hidden border border-rose-200 dark:border-rose-800 bg-gradient-to-br from-rose-50 to-purple-50 dark:from-rose-900/20 dark:to-purple-900/20 aspect-video flex items-center justify-center relative">
                <div className="absolute inset-0 bg-cover bg-center opacity-30" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'400\' height=\'225\'%3E%3Crect fill=\'%23fce7f3\' width=\'400\' height=\'225\'/%3E%3Ccircle cx=\'150\' cy=\'100\' r=\'30\' fill=\'%23f9a8d4\'/%3E%3Ctext x=\'150\' y=\'105\' text-anchor=\'middle\' fill=\'white\' font-size=\'12\'%3E配音%3C/text%3E%3Ccircle cx=\'250\' cy=\'120\' r=\'20\' fill=\'%23c4b5fd\'/%3E%3Ctext x=\'250\' y=\'125\' text-anchor=\'middle\' fill=\'white\' font-size=\'10\'%3E动效%3C/text%3E%3C/svg%3E")' }} />
                <div className="relative text-center space-y-2 z-10">
                  <div className="w-12 h-12 mx-auto rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center">
                    <Wand2 size={24} className="text-green-500" />
                  </div>
                  <p className="text-sm font-medium text-slate-600 dark:text-slate-300">动态效果</p>
                  <p className="text-[10px] text-slate-400">配音 + 动效合成后</p>
                </div>
                <div className="absolute top-2 right-2 px-2 py-0.5 rounded bg-green-500/20 text-green-700 dark:text-green-400 text-[10px] font-medium">
                  +配音动效
                </div>
              </div>
            </div>
            <p className="text-xs text-slate-400 mt-3 flex items-center gap-1">
              <Sparkles size={12} className="text-amber-400" />
              选择章节并点击「开始生成」即可创建你的动态漫画
            </p>
          </Card>
        )}

        <div className="h-8" />
      </div>
    </div>
  );
}
