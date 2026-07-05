'use client';

import React, { useState } from 'react';
import { App, Skeleton } from 'antd';
import {
  GraduationCap, BookOpen, Target, Brain, Trophy, Star,
  Flame, Clock, TrendingUp, Zap, RefreshCw, CheckCircle2,
  ArrowRight, Languages, BookMarked, Sparkles, Upload
} from 'lucide-react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { learnApi, type LearningProgress, type UserAchievement, type ReviewWord } from '@/services/search';

interface ReviewWordItem {
  word: string;
  reading: string;
  translation: string;
  mastery_level: number;
  progress_id: string;
  vocab_id: string;
  example_sentence?: string;
}

interface ReviewState {
  words: ReviewWordItem[];
  session_id: string;
  total: number;
}

const MASTERY_LABELS = ['新学', '初识', '熟悉', '掌握', '熟练', '精通'];
const MASTERY_COLORS = ['default', 'red', 'orange', 'blue', 'green', 'gold'];

export default function LearnPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [activeLang, setActiveLang] = useState<string>('ja');
  const [reviewWords, setReviewWords] = useState<ReviewState | null>(null);
  const [currentWordIdx, setCurrentWordIdx] = useState(0);
  const [reviewing, setReviewing] = useState(false);

  const { data: progress, isLoading: progressLoading, isError: progressError, refetch: refetchProgress } = useQuery({
    queryKey: ['learn-progress', activeLang],
    queryFn: async () => {
      const res = await learnApi.getProgress(activeLang);
      const rawData = res.data?.data;
      // B4 fix: ensure always returns an array (API may return { items: [...] } or direct array)
      if (Array.isArray(rawData)) return rawData as LearningProgress[];
      if (rawData?.items && Array.isArray(rawData.items)) return rawData.items as LearningProgress[];
      return [] as LearningProgress[];
    },
    staleTime: 30_000,
  });

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['learn-stats'],
    queryFn: async () => {
      const res = await learnApi.getWordStats();
      const rawData = res.data?.data;
      // B4 fix: ensure stats is always an object with expected shape
      if (rawData && typeof rawData === 'object' && !Array.isArray(rawData)) {
        return rawData;
      }
      return { total_words: 0, mastered: 0, reviewing: 0, new_words: 0 };
    },
    staleTime: 60_000,
  });

  const { data: achievements, isLoading: achievLoading } = useQuery({
    queryKey: ['learn-achievements'],
    queryFn: async () => {
      const res = await learnApi.getAchievements();
      const rawData = res.data?.data;
      // B4 fix: ensure always returns an array
      if (Array.isArray(rawData)) return rawData as UserAchievement[];
      if (rawData?.items && Array.isArray(rawData.items)) return rawData.items as UserAchievement[];
      return [] as UserAchievement[];
    },
    staleTime: 5 * 60_000,
  });

  const startReviewMutation = useMutation({
    mutationFn: () => learnApi.getReview(activeLang || undefined, 10),
    onSuccess: (res) => {
      const session = res.data?.data;
      const items = session?.items || [];
      if (items.length > 0) {
        const words = items.map((it: any) => ({
          word: it.word,
          reading: it.reading || '',
          translation: it.translation || it.meaning || '',
          mastery_level: it.mastery_level || 1,
          progress_id: it.progress_id,
          vocab_id: it.vocab_id,
          example_sentence: it.example_sentence || '',
        }));
        setReviewWords({ words, session_id: '', total: words.length });
        setCurrentWordIdx(0);
        setReviewing(true);
      } else {
        message.info('暂无待复习词汇，完成翻译后单词会自动加入学习列表');
      }
    },
    onError: (err: Error) => {
      message.warning(err.message || '获取复习词汇失败，请稍后重试');
    },
  });

  const updateProgressMutation = useMutation({
    mutationFn: ({ id, level }: { id: string; level: number }) =>
      learnApi.updateProgress(id, level),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['learn-progress'] });
      queryClient.invalidateQueries({ queryKey: ['learn-stats'] });
    },
  });

  const handleRate = (rating: 1 | 2 | 3 | 4) => {
    if (!reviewWords || currentWordIdx >= reviewWords.words.length) return;
    const word = reviewWords.words[currentWordIdx];
    const newLevel = Math.min(5, Math.max(1, word.mastery_level + (rating > 2 ? 1 : -1)));
    
    // Update progress which now also updates the Ebbinghaus schedule (next_review_at, last_review_at)
    updateProgressMutation.mutate({ id: word.progress_id, level: newLevel });

    if (currentWordIdx + 1 < reviewWords.words.length) {
      setCurrentWordIdx(currentWordIdx + 1);
    } else {
      message.success('本轮复习完成！');
      setReviewing(false);
      setReviewWords(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      {/* 顶部操作栏 - 使用玻璃态效果 */}
      <div className="sticky top-0 z-10 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-b border-slate-200/50 dark:border-slate-800/50">
        <div className="max-w-5xl mx-auto px-6 py-4">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-teal-400 to-emerald-500 flex items-center justify-center shadow-lg shadow-teal-500/20 dark:shadow-teal-500/10">
                <GraduationCap size={22} className="text-white" />
              </div>
              <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 animate-pulse" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
                学习中心
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                基于艾宾浩斯遗忘曲线的智能单词学习系统
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        {/* 统计卡片 - 使用玻璃态卡片设计 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { icon: BookOpen, label: '总词汇', value: stats?.total_words || 0, color: 'from-blue-400 to-blue-600', bgColor: 'bg-blue-50 dark:bg-blue-900/20', textColor: 'text-blue-600 dark:text-blue-400' },
            { icon: Brain, label: '已掌握', value: stats?.mastered || 0, color: 'from-emerald-400 to-emerald-600', bgColor: 'bg-emerald-50 dark:bg-emerald-900/20', textColor: 'text-emerald-600 dark:text-emerald-400' },
            { icon: RefreshCw, label: '复习中', value: stats?.reviewing || 0, color: 'from-amber-400 to-orange-500', bgColor: 'bg-amber-50 dark:bg-amber-900/20', textColor: 'text-amber-600 dark:text-amber-400' },
            { icon: Zap, label: '新词汇', value: stats?.new_words || 0, color: 'from-violet-400 to-purple-600', bgColor: 'bg-violet-50 dark:bg-violet-900/20', textColor: 'text-violet-600 dark:text-violet-400' },
          ].map((s, i) => (
            <div
              key={i}
              className="glass-card p-5 cursor-default group hover:border-slate-300/60 dark:hover:border-slate-600/60"
              style={{ animationDelay: `${i * 0.1}s` }}
            >
              <div className="flex items-start justify-between mb-3">
                <div className={`w-10 h-10 rounded-xl ${s.bgColor} flex items-center justify-center group-hover:scale-110 transition-transform duration-300`}>
                  <s.icon size={20} className={s.textColor} />
                </div>
                <div className={`text-3xl font-bold bg-gradient-to-br ${s.color} bg-clip-text text-transparent`}>
                  {s.value}
                </div>
              </div>
              <div className="text-sm font-semibold text-slate-600 dark:text-slate-400">
                {s.label}
              </div>
            </div>
          ))}
        </div>

        {/* 复习模式 - 使用精美的卡片设计 */}
        {reviewing && reviewWords && currentWordIdx < reviewWords.words.length ? (
          <div className="glass-card p-8 md:p-10 relative overflow-hidden">
            {/* 装饰性渐变背景 */}
            <div className="absolute inset-0 bg-gradient-to-br from-teal-50/50 via-transparent to-emerald-50/30 dark:from-teal-900/10 dark:to-emerald-900/10 pointer-events-none" />
            
            <div className="relative text-center space-y-8">
              {/* 进度条 */}
              <div className="max-w-md mx-auto">
                <div className="h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-teal-400 to-emerald-500 rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${Math.round((currentWordIdx / reviewWords.words.length) * 100)}%` }}
                  />
                </div>
                <div className="flex items-center justify-between mt-2 text-xs text-slate-500 dark:text-slate-400">
                  <span>进度 {currentWordIdx} / {reviewWords.words.length}</span>
                  <span>{Math.round((currentWordIdx / reviewWords.words.length) * 100)}%</span>
                </div>
              </div>

              {/* 单词展示 */}
              <div className="space-y-4">
                <div className="text-4xl md:text-5xl font-bold text-slate-900 dark:text-white tracking-tight">
                  {reviewWords.words[currentWordIdx].word}
                </div>
                {reviewWords.words[currentWordIdx].reading && (
                  <div className="text-lg text-slate-500 dark:text-slate-400 font-medium">
                    {reviewWords.words[currentWordIdx].reading}
                  </div>
                )}
                <div className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-teal-50 to-emerald-50 dark:from-teal-900/20 dark:to-emerald-900/20 border border-teal-200/50 dark:border-teal-700/30">
                  <Languages size={18} className="text-teal-600 dark:text-teal-400" />
                  <span className="text-xl text-teal-700 dark:text-teal-300 font-semibold">
                    {reviewWords.words[currentWordIdx].translation || '（暂无翻译）'}
                  </span>
                </div>
              </div>

              {/* 例句 */}
              {reviewWords.words[currentWordIdx].example_sentence && (
                <div className="max-w-lg mx-auto p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/50 dark:border-slate-700/50">
                  <div className="flex items-start gap-2">
                    <div className="p-1.5 rounded-lg bg-teal-100 dark:bg-teal-900/30 flex-shrink-0">
                      <BookOpen size={14} className="text-teal-600 dark:text-teal-400" />
                    </div>
                    <div className="text-sm text-slate-600 dark:text-slate-300 text-left">
                      {reviewWords.words[currentWordIdx].example_sentence.split('\n').map((line, i) => (
                        <div key={i} className={i === 0 ? 'mb-1 font-semibold' : ''}>
                          {line}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* 掌握度标签 */}
              <div className="flex items-center justify-center gap-2">
                <span className="text-xs text-slate-500 dark:text-slate-400">掌握度：</span>
                <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold ${
                  reviewWords.words[currentWordIdx].mastery_level >= 4
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                    : reviewWords.words[currentWordIdx].mastery_level >= 2
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                    : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                }`}>
                  {MASTERY_LABELS[reviewWords.words[currentWordIdx].mastery_level] || '未知'}
                </span>
              </div>

              {/* 评分按钮 */}
              <div className="flex items-center justify-center gap-3 md:gap-4">
                {[
                  { key: 1, label: '不认识', color: 'from-red-400 to-red-600', bgColor: 'hover:bg-red-50 dark:hover:bg-red-900/20', borderColor: 'hover:border-red-300 dark:hover:border-red-700' },
                  { key: 2, label: '模糊', color: 'from-amber-400 to-amber-600', bgColor: 'hover:bg-amber-50 dark:hover:bg-amber-900/20', borderColor: 'hover:border-amber-300 dark:hover:border-amber-700' },
                  { key: 3, label: '认识', color: 'from-blue-400 to-blue-600', bgColor: 'hover:bg-blue-50 dark:hover:bg-blue-900/20', borderColor: 'hover:border-blue-300 dark:hover:border-blue-700' },
                  { key: 4, label: '很熟', color: 'from-emerald-400 to-emerald-600', bgColor: 'hover:bg-emerald-50 dark:hover:bg-emerald-900/20', borderColor: 'hover:border-emerald-300 dark:hover:border-emerald-700' },
                ].map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => handleRate(opt.key as 1 | 2 | 3 | 4)}
                    className={`group relative px-5 py-3 rounded-2xl font-semibold text-sm transition-all duration-300 ${opt.bgColor} ${opt.borderColor} border-2 border-transparent hover:shadow-lg hover:-translate-y-0.5`}
                  >
                    <span className={`bg-gradient-to-r ${opt.color} bg-clip-text text-transparent group-hover:opacity-80`}>
                      {opt.label}
                    </span>
                    <div className={`absolute inset-0 rounded-2xl bg-gradient-to-r ${opt.color} opacity-0 group-hover:opacity-10 transition-opacity duration-300 pointer-events-none`} />
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* 单词复习列表 */
          <div className="glass-card overflow-hidden">
            {/* 头部区域 */}
            <div className="p-5 border-b border-slate-200/50 dark:border-slate-700/50">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-400 to-emerald-500 flex items-center justify-center shadow-lg shadow-teal-500/20">
                    <Brain size={20} className="text-white" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">
                      单词复习
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      管理你的学习进度
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <select
                    value={activeLang}
                    onChange={(e) => setActiveLang(e.target.value)}
                    className="text-sm bg-slate-100 dark:bg-slate-800 border-0 rounded-xl px-3 py-2 text-slate-600 dark:text-slate-300 cursor-pointer focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                  >
                    <option value="ja">日语</option>
                    <option value="en">英语</option>
                    <option value="ko">韩语</option>
                    <option value="zh">中文</option>
                    <option value="">全部</option>
                  </select>
                  <button
                    onClick={() => startReviewMutation.mutate()}
                    disabled={startReviewMutation.isPending}
                    className="btn-primary text-sm py-2.5 px-5"
                  >
                    <Brain size={16} />
                    {startReviewMutation.isPending ? '准备中...' : '开始复习'}
                  </button>
                </div>
              </div>
            </div>

            {/* 内容区域 */}
            <div className="p-5">
              {progressLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="flex items-center gap-4 p-3">
                      <div className="skeleton w-24 h-4 rounded-lg" />
                      <div className="skeleton flex-1 h-4 rounded-lg" />
                      <div className="skeleton w-32 h-4 rounded-lg" />
                    </div>
                  ))}
                </div>
              ) : (progress || []).length === 0 ? (
                <div className="text-center py-16">
                  <div className="relative inline-flex mb-6">
                    <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-teal-100 to-emerald-100 dark:from-teal-900/30 dark:to-emerald-900/20 flex items-center justify-center">
                      <BookMarked size={36} className="text-teal-500 dark:text-teal-400" />
                    </div>
                    <div className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg animate-bounce">
                      <Sparkles size={14} className="text-white" />
                    </div>
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-3">
                    开始你的学习之旅
                  </h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 max-w-md mx-auto leading-relaxed">
                    翻译漫画时，系统会自动提取生词加入学习列表。你还可以通过「开始复习」按钮获取需要复习的词汇。
                  </p>
                  <div className="flex items-center justify-center gap-6 text-xs text-slate-400 mb-8">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800">
                      <Upload size={14} className="text-primary-500" />
                      <span>上传翻译自动收集词汇</span>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800">
                      <Sparkles size={14} className="text-amber-500" />
                      <span>艾宾浩斯记忆法</span>
                    </div>
                  </div>
                  <Link
                    href="/pc/upload"
                    className="btn-primary inline-flex px-6 py-3"
                  >
                    <Upload size={16} />
                    去上传翻译
                  </Link>
                </div>
              ) : (
                <div className="space-y-1">
                  {(progress || []).slice(0, 20).map((p, index) => (
                    <div
                      key={p.progress_id}
                      className="group flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-all duration-200 cursor-default"
                      style={{ animationDelay: `${index * 0.03}s` }}
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-slate-100 to-slate-50 dark:from-slate-800 dark:to-slate-700 flex items-center justify-center group-hover:scale-110 transition-transform duration-200">
                          <BookOpen size={14} className="text-slate-500 dark:text-slate-400" />
                        </div>
                        <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                          {p.word}
                        </span>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          p.mastery_level >= 4
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                            : p.mastery_level >= 2
                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                            : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                        }`}>
                          {MASTERY_LABELS[p.mastery_level] || '未知'}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-400 dark:text-slate-500">
                        <div className="flex items-center gap-1">
                          <RefreshCw size={11} />
                          <span>复习 {p.review_count} 次</span>
                        </div>
                        <span className="text-slate-300 dark:text-slate-600">·</span>
                        <div className="flex items-center gap-1">
                          <Clock size={11} />
                          <span>下次 {p.next_review_at ? new Date(p.next_review_at).toLocaleDateString() : '--'}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 成就系统 - 精美卡片设计 */}
        <div className="glass-card overflow-hidden">
          {/* 头部区域 */}
          <div className="p-5 border-b border-slate-200/50 dark:border-slate-700/50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/20">
                <Trophy size={20} className="text-white" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  成就徽章
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  完成学习任务，解锁成就奖励
                </p>
              </div>
            </div>
          </div>

          {/* 成就列表 */}
          <div className="p-5">
            {achievLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="skeleton h-40 rounded-2xl" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {(achievements || []).map((ua, index) => (
                  <div
                    key={ua.user_achievement_id}
                    className={`group relative p-5 rounded-2xl border-2 transition-all duration-300 ${
                      ua.completed
                        ? 'bg-gradient-to-br from-amber-50/50 to-orange-50/30 dark:from-amber-900/10 dark:to-orange-900/10 border-amber-200/50 dark:border-amber-700/30 hover:shadow-lg hover:shadow-amber-500/10 hover:-translate-y-1'
                        : 'bg-slate-50/50 dark:bg-slate-800/30 border-slate-200/50 dark:border-slate-700/30 opacity-60 hover:opacity-80'
                    }`}
                    style={{ animationDelay: `${index * 0.05}s` }}
                  >
                    {/* 完成标记 */}
                    {ua.completed && (
                      <div className="absolute top-3 right-3">
                        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/25">
                          <CheckCircle2 size={14} className="text-white" />
                        </div>
                      </div>
                    )}

                    <div className="text-center space-y-3">
                      <div className={`text-4xl ${ua.completed ? 'group-hover:scale-110' : 'grayscale'} transition-transform duration-300`}>
                        {ua.achievement.icon}
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-1">
                          {ua.achievement.name}
                        </h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                          {ua.achievement.description}
                        </p>
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-500 dark:text-slate-400">进度</span>
                          <span className={`font-semibold ${ua.completed ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-400'}`}>
                            {ua.completed ? '100' : Math.round(ua.progress * 100)}%
                          </span>
                        </div>
                        <div className="h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-700 ease-out ${
                              ua.completed
                                ? 'bg-gradient-to-r from-emerald-400 to-emerald-600'
                                : 'bg-gradient-to-r from-amber-400 to-orange-500'
                            }`}
                            style={{ width: `${ua.completed ? 100 : Math.round(ua.progress * 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {(!achievements || achievements.length === 0) && !achievLoading && (
              <div className="text-center py-12">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                  <Trophy size={28} className="text-slate-400 dark:text-slate-500" />
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  暂无成就，完成翻译和学习任务来解锁
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="h-8" />
      </div>
    </div>
  );
}
