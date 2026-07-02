'use client';

import React, { useRef, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Card, Table, Tag, Spin, Button, Empty, Statistic, Row, Col, Alert, App } from 'antd';
import {
  BarChart3, TrendingUp, FileText, Download, ArrowLeft,
  MessageSquare, Zap, BookOpen, ShieldCheck, ExternalLink
} from 'lucide-react';
import type { ColumnsType } from 'antd/es/table';
import { qualityApi, type QualitySummary } from '@/services/quality';

const COLOR_THRESHOLDS = { green: 80, yellow: 60, red: 0 };

function qualityColor(score: number): string {
  if (score >= COLOR_THRESHOLDS.green) return '#10b981';
  if (score >= COLOR_THRESHOLDS.yellow) return '#f59e0b';
  return '#ef4444';
}

/** 空值安全格式化：null/undefined → 'N/A'（无参考译文时 BLEU/METEOR 诚实为 null）。 */
function fmtScore(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined ? 'N/A' : v.toFixed(digits);
}

function qualityTag(score: number, label: string) {
  return (
    <Tag color={score >= 80 ? 'green' : score >= 60 ? 'gold' : 'red'}>
      {label}: {score.toFixed(1)}
    </Tag>
  );
}

export default function QualityPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { message } = App.useApp();
  const projectId = params.id!;
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const { data: summary, isLoading, error } = useQuery({
    queryKey: ['quality-project', projectId],
    queryFn: async () => {
      const res = await qualityApi.getProjectSummary(projectId);
      return (res.data?.data || null) as QualitySummary | null;
    },
    enabled: !!projectId,
    staleTime: 30_000,
  });

  // Draw radar chart
  useEffect(() => {
    if (!summary?.radar_data || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { labels, values } = summary.radar_data;
    if (!labels?.length || !values?.length) return;

    const dpr = window.devicePixelRatio || 1;
    const w = 300, h = 300;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = '300px';
    canvas.style.height = '300px';
    ctx.scale(dpr, dpr);

    const cx = w / 2, cy = h / 2, r = 120;
    const steps = labels.length;
    const angleStep = (Math.PI * 2) / steps;

    // Background grid
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    for (let level = 1; level <= 3; level++) {
      ctx.beginPath();
      for (let i = 0; i < steps; i++) {
        const angle = angleStep * i - Math.PI / 2;
        const lr = (r / 3) * level;
        const x = cx + Math.cos(angle) * lr;
        const y = cy + Math.sin(angle) * lr;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }

    // Axes
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1;
    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#475569';
    ctx.textAlign = 'center';
    for (let i = 0; i < steps; i++) {
      const angle = angleStep * i - Math.PI / 2;
      const lx = cx + Math.cos(angle) * (r + 20);
      const ly = cy + Math.sin(angle) * (r + 20);
      ctx.fillText(labels[i] || '', lx, ly);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
      ctx.stroke();
    }

    // Data polygon
    ctx.beginPath();
    for (let i = 0; i < steps; i++) {
      const angle = angleStep * i - Math.PI / 2;
      const val = Math.max(0, Math.min(1, (values[i] || 0) / 100));
      const dx = cx + Math.cos(angle) * r * val;
      const dy = cy + Math.sin(angle) * r * val;
      i === 0 ? ctx.moveTo(dx, dy) : ctx.lineTo(dx, dy);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
    ctx.fill();
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Data points
    for (let i = 0; i < steps; i++) {
      const angle = angleStep * i - Math.PI / 2;
      const val = Math.max(0, Math.min(1, (values[i] || 0) / 100));
      ctx.beginPath();
      ctx.arc(cx + Math.cos(angle) * r * val, cy + Math.sin(angle) * r * val, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#3b82f6';
      ctx.fill();
    }
  }, [summary]);

  const handleExportCSV = () => {
    if (!summary) return;
    const dims = summary.radar_data?.labels || [];
    const vals = summary.radar_data?.values || [];
    let csv = '维度,分数\n';
    dims.forEach((d, i) => { csv += `${d},${vals[i] || 0}\n`; });
    csv += `\nBLEU总分,${fmtScore(summary.avg_bleu)}\n`;
    csv += `METEOR总分,${fmtScore(summary.avg_meteor)}\n`;
    csv += `综合评分,${fmtScore(summary.avg_overall)}\n`;

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `quality_report_${projectId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    message.success('报告已导出');
  };

  if (isLoading) return <div className="flex items-center justify-center h-full"><Spin size="large" /></div>;

  if (!summary || summary.total_pages === 0) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <Empty
          description="暂无质量数据，请先完成翻译后评估"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        >
          <Button type="primary" onClick={() => router.push(`/pc/projects/${projectId}`)}>
            去编辑项目
          </Button>
        </Empty>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="sticky top-0 z-10 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center">
              <BarChart3 size={22} className="text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 dark:text-white">翻译质量报告</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                基于真实信号评估：OCR置信度、翻译覆盖率、机翻置信度、术语一致性（BLEU 仅在有参考译文时计算）
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="small" icon={<ArrowLeft size={14} />} onClick={() => router.push(`/pc/projects/${projectId}`)}>
              返回项目
            </Button>
            <Button size="small" icon={<Download size={14} />} onClick={handleExportCSV}>
              导出 CSV
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        {/* Stats cards */}
        <Row gutter={[16, 16]}>
          <Col xs={12} sm={6}>
            <Card size="small" className="text-center">
              <Statistic
                title={<span className="flex items-center justify-center gap-1 text-xs"><MessageSquare size={12} />BLEU 总分</span>}
                value={fmtScore(summary.avg_bleu)}
                valueStyle={{ color: qualityColor(summary.avg_bleu ?? 0), fontSize: 28 }}
                suffix={summary.avg_bleu === null || summary.avg_bleu === undefined ? '' : '/100'}
              />
            </Card>
          </Col>
          <Col xs={12} sm={6}>
            <Card size="small" className="text-center">
              <Statistic
                title={<span className="flex items-center justify-center gap-1 text-xs"><Zap size={12} />METEOR 总分</span>}
                value={fmtScore(summary.avg_meteor)}
                valueStyle={{ color: qualityColor(summary.avg_meteor ?? 0), fontSize: 28 }}
                suffix={summary.avg_meteor === null || summary.avg_meteor === undefined ? '' : '/100'}
              />
            </Card>
          </Col>
          <Col xs={12} sm={6}>
            <Card size="small" className="text-center">
              <Statistic
                title={<span className="flex items-center justify-center gap-1 text-xs"><BookOpen size={12} />机翻置信度</span>}
                value={summary.radar_data?.values?.[2] || 0}
                precision={0}
                valueStyle={{ color: qualityColor(summary.radar_data?.values?.[2] || 0), fontSize: 28 }}
                suffix="%"
              />
            </Card>
          </Col>
          <Col xs={12} sm={6}>
            <Card size="small" className="text-center">
              <Statistic
                title={<span className="flex items-center justify-center gap-1 text-xs"><ShieldCheck size={12} />术语一致性</span>}
                value={summary.radar_data?.values?.[3] || 0}
                precision={0}
                valueStyle={{ color: qualityColor(summary.radar_data?.values?.[3] || 0), fontSize: 28 }}
                suffix="%"
              />
            </Card>
          </Col>
        </Row>

        {/* Radar chart */}
        <Card
          title={<span className="flex items-center gap-2"><TrendingUp size={16} className="text-blue-500" />四维雷达图</span>}
        >
          <div className="flex justify-center py-4">
            <canvas ref={canvasRef} />
          </div>
          <div className="flex justify-center gap-6 text-xs text-slate-500 mt-2">
            {summary.radar_data?.labels?.map((l, i) => (
              <div key={i} className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: `hsl(${i * 90}, 70%, 50%)` }} />
                {l}: {(summary.radar_data?.values?.[i] || 0).toFixed(0)}
              </div>
            )) || null}
          </div>
        </Card>

        {/* Trend */}
        {summary.trend && summary.trend.length > 0 && (
          <Card
            title={<span className="flex items-center gap-2"><TrendingUp size={16} className="text-green-500" />评分趋势</span>}
          >
            <div className="flex items-end gap-2 h-32">
              {summary.trend.map((t, i) => {
                const height = Math.max(4, (t.score / 100) * 128);
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[10px] text-slate-500">{t.score.toFixed(0)}</span>
                    <div
                      className="w-full rounded-t"
                      style={{
                        height: `${height}px`,
                        backgroundColor: qualityColor(t.score),
                        opacity: 0.8,
                      }}
                    />
                    <span className="text-[10px] text-slate-400">{t.date.slice(5)}</span>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {/* Page scores */}
        <Card
          title={<span className="flex items-center gap-2"><FileText size={16} className="text-slate-500" />页面评分详情</span>}
        >
          <Alert
            className="mb-4"
            type="info"
            message={`已评估 ${summary.scored_pages} / ${summary.total_pages} 页 | 综合均分 ${fmtScore(summary.avg_overall)}`}
            showIcon
          />
          <div className="space-y-2">
            {(!summary.pages || summary.pages.length === 0) ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="尚无逐页评分，请在编辑页对页面运行质量评估"
              />
            ) : (
              summary.pages.map((p, i) => {
                const metrics = [
                  { label: 'BLEU', value: p.bleu_score },
                  { label: '机翻', value: p.mt_confidence },
                  { label: '术语', value: p.term_consistency },
                  { label: '综合', value: p.overall_score },
                ];
                return (
                  <div
                    key={p.page_id}
                    className="flex items-center gap-4 p-3 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors border border-slate-100 dark:border-slate-800"
                    onClick={() => router.push(`/pc/projects/${projectId}/review?page=${(p.sort_order ?? i) + 1}`)}
                  >
                    <span className="text-sm font-mono text-slate-400 w-8">P{(p.sort_order ?? i) + 1}</span>
                    <div className="flex-1 flex items-center gap-3">
                      {metrics.map((m) => (
                        <div key={m.label} className="flex items-center gap-1">
                          <span className="text-[10px] text-slate-400 w-8">{m.label}</span>
                          <div className="w-16 h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${m.value ?? 0}%`,
                                backgroundColor: qualityColor(m.value ?? 0),
                              }}
                            />
                          </div>
                          <span className="text-[10px] text-slate-400 w-8">{fmtScore(m.value, 0)}</span>
                        </div>
                      ))}
                    </div>
                    <ExternalLink size={12} className="text-slate-300" />
                  </div>
                );
              })
            )}
          </div>
        </Card>

        <div className="h-8" />
      </div>
    </div>
  );
}
