'use client';

import React, { useState } from 'react';
import { Card, Button, Progress, Tag, Space, Statistic, Spin, App, Tabs, Row, Col, Badge, Select, Skeleton, Result, Empty } from 'antd';
import {
  GraduationCap, BookOpen, Target, Brain, Trophy, Star,
  Flame, Clock, TrendingUp, Zap, RefreshCw, CheckCircle2,
  ArrowRight, Languages, BookMarked, Sparkles, Upload
} from 'lucide-react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { learnApi, type LearningProgress, type UserAchievement, type ReviewSession } from '@/services/search';

const MASTERY_LABELS = ['新学', '初识', '熟悉', '掌握', '熟练', '精通'];
const MASTERY_COLORS = ['default', 'red', 'orange', 'blue', 'green', 'gold'];

export default function LearnPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [activeLang, setActiveLang] = useState<string>('ja');
  const [reviewWords, setReviewWords] = useState<ReviewSession | null>(null);
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
    mutationFn: () => learnApi.getReview(activeLang, 10),
    onSuccess: (res) => {
      const session = res.data?.data;
      const words = session?.words || [];
      if (words.length > 0) {
        setReviewWords({ ...session, words });
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
    updateProgressMutation.mutate({ id: word.word, level: newLevel });

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
      <div className="sticky top-0 z-10 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-50 dark:bg-teal-900/30 flex items-center justify-center">
              <GraduationCap size={22} className="text-teal-600 dark:text-teal-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 dark:text-white">学习中心</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                基于艾宾浩斯遗忘曲线的单词学习系统
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        {/* 统计卡片 */}
        <Row gutter={[16, 16]}>
          {[
            { icon: BookOpen, label: '总词汇', value: stats?.total_words || 0, color: 'text-blue-500' },
            { icon: Brain, label: '已掌握', value: stats?.mastered || 0, color: 'text-green-500' },
            { icon: RefreshCw, label: '复习中', value: stats?.reviewing || 0, color: 'text-orange-500' },
            { icon: Zap, label: '新词汇', value: stats?.new_words || 0, color: 'text-purple-500' },
          ].map((s, i) => (
            <Col xs={12} sm={6} key={i}>
              <Card size="small" className="text-center">
                <Statistic
                  title={
                    <span className="flex items-center justify-center gap-1 text-xs text-slate-500">
                      <s.icon size={14} className={s.color} />
                      {s.label}
                    </span>
                  }
                  value={s.value}
                  valueStyle={{ fontSize: 24 }}
                />
              </Card>
            </Col>
          ))}
        </Row>

        {/* 复习模式 */}
        {reviewing && reviewWords && currentWordIdx < reviewWords.words.length ? (
          <Card className="text-center" size="large">
            <div className="py-8 space-y-6">
              <Progress
                percent={Math.round(((currentWordIdx) / reviewWords.words.length) * 100)}
                size="small"
              />
              <div className="text-3xl font-bold text-slate-900 dark:text-white">
                {reviewWords.words[currentWordIdx].word}
              </div>
              <div className="text-lg text-slate-500 italic">
                {reviewWords.words[currentWordIdx].translation}
              </div>
              <div className="text-xs text-slate-400">
                掌握度：{MASTERY_LABELS[reviewWords.words[currentWordIdx].mastery_level] || '未知'}
              </div>
              <Space size="large">
                {[
                  { key: 1, label: '不认识', color: '#ef4444' },
                  { key: 2, label: '模糊', color: '#f59e0b' },
                  { key: 3, label: '认识', color: '#3b82f6' },
                  { key: 4, label: '很熟', color: '#10b981' },
                ].map((opt) => (
                  <Button
                    key={opt.key}
                    size="large"
                    onClick={() => handleRate(opt.key as 1 | 2 | 3 | 4)}
                    style={{ borderColor: opt.color, color: opt.color }}
                  >
                    {opt.label}
                  </Button>
                ))}
              </Space>
              <p className="text-xs text-slate-400">{currentWordIdx + 1} / {reviewWords.words.length}</p>
            </div>
          </Card>
        ) : (
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold flex items-center gap-2">
                <Brain size={18} className="text-teal-500" />
                单词复习
              </h3>
              <Space>
                <Select
                  size="small"
                  value={activeLang}
                  onChange={setActiveLang}
                  options={[
                    { value: 'ja', label: '日语' },
                    { value: 'en', label: '英语' },
                    { value: 'ko', label: '韩语' },
                  ]}
                  style={{ width: 90 }}
                />
                <Button
                  type="primary"
                  icon={<Brain size={14} />}
                  onClick={() => startReviewMutation.mutate()}
                  loading={startReviewMutation.isPending}
                >
                  开始复习
                </Button>
              </Space>
            </div>

            {progressLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} active paragraph={{ rows: 1 }} title={{ width: '30%' }} />
                ))}
              </div>
            ) : (progress || []).length === 0 ? (
              <div className="text-center py-10">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-teal-50 dark:bg-teal-900/30 flex items-center justify-center">
                  <BookMarked size={32} className="text-teal-400 dark:text-teal-500" />
                </div>
                <h3 className="text-base font-semibold text-slate-700 dark:text-slate-300 mb-2">
                  开始你的学习之旅
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 max-w-sm mx-auto leading-relaxed">
                  翻译漫画时，系统会自动提取生词加入学习列表。你还可以通过「开始复习」按钮获取需要复习的词汇。
                </p>
                <div className="flex items-center justify-center gap-4 text-xs text-slate-400 mb-5">
                  <div className="flex items-center gap-1.5">
                    <Upload size={14} className="text-primary-400" />
                    <span>上传翻译自动收集词汇</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Sparkles size={14} className="text-amber-400" />
                    <span>艾宾浩斯记忆法</span>
                  </div>
                </div>
                <Link
                  href="/pc/upload"
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-teal-500 text-white rounded-lg hover:bg-teal-600 transition-colors"
                >
                  <Upload size={14} />
                  去上传翻译
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                {(progress || []).slice(0, 20).map((p) => (
                  <div
                    key={p.progress_id}
                    className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                        {p.word}
                      </span>
                      <Tag color={MASTERY_COLORS[p.mastery_level] || 'default'}>
                        {MASTERY_LABELS[p.mastery_level] || '未知'}
                      </Tag>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <Clock size={12} />
                      <span>复习 {p.review_count} 次</span>
                      <span>·</span>
                      <span>下次 {p.next_review_at ? new Date(p.next_review_at).toLocaleDateString() : '--'}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* 成就系统 */}
        <Card
          title={
            <span className="flex items-center gap-2">
              <Trophy size={18} className="text-amber-500" />
              成就徽章
            </span>
          }
        >
          {achievLoading ? (
            <Spin><div className="h-20" /></Spin>
          ) : (
            <Row gutter={[12, 12]}>
              {(achievements || []).map((ua) => (
                <Col xs={12} sm={8} md={6} key={ua.user_achievement_id}>
                  <Card
                    size="small"
                    className={ua.completed ? '' : 'opacity-50'}
                    hoverable={ua.completed}
                  >
                    <div className="text-center space-y-2">
                      <div className="text-2xl">{ua.achievement.icon}</div>
                      <p className="text-sm font-medium">{ua.achievement.name}</p>
                      <p className="text-xs text-slate-400">{ua.achievement.description}</p>
                      <Progress
                        percent={ua.completed ? 100 : Math.round(ua.progress * 100)}
                        size="small"
                        status={ua.completed ? 'success' : 'active'}
                      />
                    </div>
                  </Card>
                </Col>
              ))}
            </Row>
          )}
          {(!achievements || achievements.length === 0) && !achievLoading && (
            <Empty description="暂无成就，完成翻译和学习任务来解锁" />
          )}
        </Card>

        <div className="h-8" />
      </div>
    </div>
  );
}
