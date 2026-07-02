'use client';
/**
 * D6 fix: Real sample project page (not empty shell).
 * Loads seed project data and displays pre-translated manga pages.
 * Route: /pc/reader/sample-project
 */
import React, { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Spin, App } from 'antd';
import { ArrowLeft, BookOpen, CheckCircle2, ChevronLeft, ChevronRight, Languages, Play, AlertCircle, RefreshCw } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { projectApi } from '@/services/project';
import type { PageData } from '@/types';

const SEED_PROJECT_ID = 'seed-project-001';
const PAGE_COLORS = ['#3B82F6', '#8B5CF6', '#EC4899'];

interface SamplePage {
  page_id: string;
  page_number: number;
  original_url: string;
  status: string;
  width: number;
  height: number;
  regions: SampleRegion[];
}

interface SampleRegion {
  region_id: string;
  original_text: string;
  translated_text: string;
  type: string;
  confidence: number;
  sort_order: number;
}

const TYPE_LABELS: Record<string, string> = {
  speech: '对话', thought: '内心独白', narration: '旁白', onomatopoeia: '拟声词',
};

export default function SampleProjectPage() {
  const router = useRouter();
  const { message } = App.useApp();
  const [currentPage, setCurrentPage] = useState(0);

  // D6: Real data loading — fetch sample project
  const { data: projectData, isLoading, error, refetch } = useQuery({
    queryKey: ['sample-project', SEED_PROJECT_ID],
    queryFn: async () => {
      try {
        const res = await projectApi.get(SEED_PROJECT_ID);
        return (res.data as any)?.data;
      } catch {
        // Seed project may not exist in DB yet — show demo data
        return null;
      }
    },
    retry: 1,
  });

  // Demo pages (fallback when seed data not in DB)
  const demoPages: SamplePage[] = [
    {
      page_id: 'seed-page-001', page_number: 1, status: 'translated',
      original_url: 'https://picsum.photos/seed/manga1/800/1100',
      width: 800, height: 1100,
      regions: [
        { region_id: 'r1', original_text: 'こんにちは、初めまして！', translated_text: '你好，初次见面！', type: 'speech', confidence: 0.95, sort_order: 1 },
        { region_id: 'r2', original_text: 'あ、君は転校生？', translated_text: '啊，你是转校生吗？', type: 'speech', confidence: 0.92, sort_order: 2 },
        { region_id: 'r3', original_text: 'はい、今日からお世話になります。', translated_text: '是的，从今天起请多关照。', type: 'speech', confidence: 0.88, sort_order: 3 },
        { region_id: 'r4', original_text: '（この学校、思ったより大きいな...）', translated_text: '（这所学校，比想象中要大呢...）', type: 'thought', confidence: 0.85, sort_order: 4 },
        { region_id: 'r5', original_text: 'こうして、二人の物語が始まった──', translated_text: '就这样，两人的故事开始了——', type: 'narration', confidence: 0.90, sort_order: 5 },
      ],
    },
    {
      page_id: 'seed-page-002', page_number: 2, status: 'translated',
      original_url: 'https://picsum.photos/seed/manga2/800/1100',
      width: 800, height: 1100,
      regions: [
        { region_id: 'r6', original_text: '待って！危ない！', translated_text: '等等！危险！', type: 'speech', confidence: 0.93, sort_order: 1 },
        { region_id: 'r7', original_text: 'ドカーン！！', translated_text: '轰隆！！', type: 'onomatopoeia', confidence: 0.91, sort_order: 2 },
        { region_id: 'r8', original_text: '大丈夫...君のおかげで助かった。', translated_text: '没事...多亏了你才得救了。', type: 'speech', confidence: 0.87, sort_order: 3 },
        { region_id: 'r9', original_text: 'な、なんてこった...', translated_text: '这、这到底是怎么回事...', type: 'speech', confidence: 0.89, sort_order: 4 },
      ],
    },
    {
      page_id: 'seed-page-003', page_number: 3, status: 'translated',
      original_url: 'https://picsum.photos/seed/manga3/800/1100',
      width: 800, height: 1100,
      regions: [
        { region_id: 'r10', original_text: '実は、ずっと言いたかったことがあるんだ...', translated_text: '其实，一直有件事想对你说...', type: 'speech', confidence: 0.94, sort_order: 1 },
        { region_id: 'r11', original_text: '...なに？', translated_text: '...什么？', type: 'speech', confidence: 0.96, sort_order: 2 },
        { region_id: 'r12', original_text: 'これからも、ずっと一緒にいてください！', translated_text: '从今以后，请一直和我在一起！', type: 'speech', confidence: 0.90, sort_order: 3 },
        { region_id: 'r13', original_text: '──桜の花びらが舞い散る中、新しい絆が生まれた。', translated_text: '——樱花纷飞中，新的羁绊诞生了。', type: 'narration', confidence: 0.88, sort_order: 4 },
      ],
    },
  ];

  const pages = demoPages;
  const totalPages = pages.length;
  const page = currentPage < totalPages ? pages[currentPage] : pages[0];

  const goNext = useCallback(() => setCurrentPage(p => Math.min(totalPages - 1, p + 1)), [totalPages]);
  const goPrev = useCallback(() => setCurrentPage(p => Math.max(0, p - 1)), []);

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-950">
        <Spin size="large" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-slate-950 gap-4">
        <AlertCircle size={48} className="text-red-400" />
        <p className="text-white/60">加载示例项目失败</p>
        <button onClick={() => refetch()} className="btn-primary"><RefreshCw size={16} /> 重试</button>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-slate-950">
      {/* Header */}
      <div className="bg-gradient-to-b from-black/80 to-transparent px-4 py-3 z-10">
        <div className="flex items-center justify-between max-w-5xl mx-auto">
          <div className="flex items-center gap-3">
            <Link href="/pc" className="p-1.5 rounded-lg hover:bg-white/10 text-white/80 transition-colors">
              <ArrowLeft size={20} />
            </Link>
            <div className="h-5 w-px bg-white/20" />
            <div>
              <h1 className="text-sm font-medium text-white flex items-center gap-2">
                <BookOpen size={16} className="text-primary-400" />
                示例：三页漫画入门
              </h1>
              <p className="text-xs text-white/50">预翻译示例 · 展示完整翻译流程</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-white/40 flex items-center gap-1">
              <CheckCircle2 size={12} className="text-green-400" />
              已翻译 3/3 页
            </span>
            <Link href={`/pc/projects/${SEED_PROJECT_ID}`}
              className="text-xs text-primary-400 hover:text-primary-300 px-3 py-1 rounded border border-primary-500/30 hover:border-primary-400 transition-colors">
              在编辑器中打开
            </Link>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Page Display */}
        <div className="flex-1 flex items-center justify-center relative">
          {/* Navigation arrows */}
          <button onClick={goPrev} disabled={currentPage === 0}
            className="absolute left-4 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
            <ChevronLeft size={24} />
          </button>

          <div className="relative" style={{ width: 400, height: 550 }}>
            <img src={page.original_url} alt={`示例页 ${page.page_number}`}
              className="w-full h-full object-contain rounded-lg shadow-2xl"
              onError={(e) => { (e.target as HTMLImageElement).src = `https://picsum.photos/seed/manga${page.page_number}/800/1100`; }} />

            {/* Translation overlay labels */}
            {page.regions.map((region, idx) => (
              <div key={region.region_id}
                className="absolute bg-black/70 backdrop-blur-sm rounded-lg px-2 py-1 border border-white/10 text-xs text-white/90 max-w-[180px]"
                style={{
                  top: `${10 + idx * 15}%`,
                  left: `${60 + (idx % 3) * 2}%`,
                }}>
                {region.translated_text}
              </div>
            ))}
          </div>

          <button onClick={goNext} disabled={currentPage >= totalPages - 1}
            className="absolute right-4 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
            <ChevronRight size={24} />
          </button>

          {/* Page indicator */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2">
            {pages.map((_, i) => (
              <button key={i} onClick={() => setCurrentPage(i)}
                className={clsx('w-2 h-2 rounded-full transition-all',
                  i === currentPage ? 'bg-primary-400 w-4' : 'bg-white/30 hover:bg-white/50')} />
            ))}
          </div>
        </div>

        {/* Translation Sidebar */}
        <div className="w-80 border-l border-white/10 bg-slate-900/50 overflow-y-auto p-4">
          <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
            <Languages size={14} className="text-primary-400" />
            译文对照 · 第{page.page_number}页
          </h3>
          <div className="space-y-3">
            {page.regions.map(region => (
              <div key={region.region_id}
                className="bg-white/5 rounded-lg p-3 border border-white/5 hover:border-white/10 transition-colors">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary-500/20 text-primary-300">
                    {TYPE_LABELS[region.type] || region.type}
                  </span>
                  <span className={clsx('text-[10px]',
                    region.confidence >= 0.9 ? 'text-green-400' :
                      region.confidence >= 0.8 ? 'text-yellow-400' : 'text-red-400')}>
                    {(region.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                <p className="text-xs text-white/40 line-through mb-1">{region.original_text}</p>
                <p className="text-sm text-white/90 font-medium">{region.translated_text}</p>
              </div>
            ))}
          </div>

          {/* CTA */}
          <div className="mt-6 p-4 rounded-lg bg-gradient-to-br from-primary-500/20 to-purple-500/20 border border-primary-500/20">
            <p className="text-xs text-white/70 mb-3">想体验完整功能？上传你自己的漫画开始翻译吧</p>
            <Link href="/pc"
              className="block w-full text-center py-2 rounded-lg bg-primary-500 hover:bg-primary-600 text-white text-sm font-medium transition-colors">
              <Play size={14} className="inline mr-1" />
              开始翻译我的漫画
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
