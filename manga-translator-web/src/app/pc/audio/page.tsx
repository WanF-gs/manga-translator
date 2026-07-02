'use client';

import React, { useState, useCallback } from 'react';
import { Card, Button, Select, Tag, Space, Progress, Empty, App, Spin, Table, Tooltip, Alert } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Volume2, Play, Pause, Download, Music, Headphones, Sparkles, Clock, FileAudio } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { audioApi, type TTSVoice, type AudioTask, type SoundEffect } from '@/services/audio';

const LANGUAGES = [
  { value: 'ja', label: '日语' },
  { value: 'zh-CN', label: '中文' },
  { value: 'en', label: '英文' },
  { value: 'ko', label: '韩文' },
];

const GENDER_COLORS: Record<string, string> = {
  male: 'blue',
  female: 'magenta',
};

export default function AudioPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [selectedLang, setSelectedLang] = useState('ja');
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [audioRef, setAudioRef] = useState<HTMLAudioElement | null>(null);

  const { data: voices, isLoading: voicesLoading, error: voicesError } = useQuery({
    queryKey: ['voices', selectedLang],
    queryFn: async () => {
      const res = await audioApi.getVoices(selectedLang);
      return (res.data?.data || []) as TTSVoice[];
    },
    staleTime: 5 * 60_000,
  });

  const generateMutation = useMutation({
    mutationFn: (data: { page_id: string; voice_id: string; text: string }) =>
      audioApi.generate(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['audio-tasks'] });
    },
  });

  const handleSynthesize = useCallback((record: TTSVoice) => {
    generateMutation.mutate(
      { page_id: 'preview', voice_id: record.voice_id, text: 'こんにちは！' },
      {
        onSuccess: (res) => {
          message.success(`「${record.name}」合成任务已提交：${res.data?.data?.task_id?.slice(0, 8) || '已创建'}`);
        },
        onError: (err: Error) => {
          message.error(err.message || '语音合成失败');
        },
      }
    );
  }, [generateMutation, message]);

  const handlePlaySample = useCallback((url: string, voiceId: string) => {
    if (audioRef) {
      audioRef.pause();
      URL.revokeObjectURL(audioRef.src);
    }
    if (playingId === voiceId) {
      setPlayingId(null);
      setAudioRef(null);
      return;
    }
    const audio = new Audio(url);
    audio.onended = () => { setPlayingId(null); setAudioRef(null); };
    audio.onerror = () => { message.warning('音频无法播放'); setPlayingId(null); setAudioRef(null); };
    audio.play().catch(() => message.warning('音频播放失败'));
    setAudioRef(audio);
    setPlayingId(voiceId);
  }, [audioRef, playingId, message]);

  // B5 fix: Fetch sound effects from API with click-to-play
  const { data: soundEffects } = useQuery({
    queryKey: ['sound-effects'],
    queryFn: async () => {
      const res = await audioApi.getSoundEffects();
      const rawData = res.data?.data;
      return (Array.isArray(rawData) ? rawData : rawData?.items || []) as SoundEffect[];
    },
    staleTime: 5 * 60_000,
  });

  const handlePlayEffect = useCallback((effect: SoundEffect) => {
    if (!effect.preview_url) {
      message.info(`${effect.name}：暂无预览音频`);
      return;
    }
    if (audioRef) {
      audioRef.pause();
      URL.revokeObjectURL(audioRef.src);
    }
    if (playingId === effect.effect_id) {
      setPlayingId(null);
      setAudioRef(null);
      return;
    }
    const audio = new Audio(effect.preview_url);
    audio.onended = () => { setPlayingId(null); setAudioRef(null); };
    audio.onerror = () => { message.warning('音效加载失败'); setPlayingId(null); setAudioRef(null); };
    audio.play().catch(() => message.warning('音效播放失败'));
    setAudioRef(audio);
    setPlayingId(effect.effect_id);
  }, [audioRef, playingId, message]);

  const columns: ColumnsType<TTSVoice> = [
    {
      title: '语音',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record) => (
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-purple-50 dark:bg-purple-900/30 flex items-center justify-center">
            <Volume2 size={18} className="text-purple-600 dark:text-purple-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-white">{name}</p>
            <p className="text-xs text-slate-400">{record.description}</p>
          </div>
        </div>
      ),
    },
    {
      title: '语言',
      dataIndex: 'language',
      key: 'language',
      width: 80,
      render: (lang: string) => <Tag>{LANGUAGES.find(l => l.value === lang)?.label || lang}</Tag>,
    },
    {
      title: '性别',
      dataIndex: 'gender',
      key: 'gender',
      width: 70,
      render: (g: string) => <Tag color={GENDER_COLORS[g] || 'default'}>{g === 'male' ? '男' : '女'}</Tag>,
    },
    {
      title: '试听',
      key: 'preview',
      width: 100,
      render: (_: unknown, record: TTSVoice) => (
        record.sample_url ? (
          <Button
            size="small"
            type={playingId === record.voice_id ? 'primary' : 'default'}
            icon={playingId === record.voice_id ? <Pause size={14} /> : <Play size={14} />}
            onClick={() => handlePlaySample(record.sample_url!, record.voice_id)}
          >
            试听
          </Button>
        ) : (
          <span className="text-xs text-slate-400">--</span>
        )
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 100,
      render: (_: unknown, record: TTSVoice) => (
        <Button
          size="small"
          type="dashed"
          icon={<Sparkles size={14} />}
          loading={generateMutation.isPending}
          onClick={() => handleSynthesize(record)}
        >
          合成
        </Button>
      ),
    },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="sticky top-0 z-10 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-50 dark:bg-purple-900/30 flex items-center justify-center">
              <Headphones size={22} className="text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 dark:text-white">音频剧场</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                TTS 语音合成，为角色赋予声音
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        {/* 语音选择 */}
        <Card
          title={<span className="flex items-center gap-2"><Music size={16} className="text-purple-500" />语音库</span>}
          extra={
            <Select
              value={selectedLang}
              onChange={setSelectedLang}
              options={LANGUAGES}
              style={{ width: 100 }}
              size="small"
            />
          }
        >
          {voicesLoading ? (
            <Spin><div className="h-40" /></Spin>
          ) : voicesError ? (
            <Alert type="error" message="语音库加载失败" description={(voicesError as Error).message || '请检查后端服务是否正常运行'} showIcon />
          ) : (
            <Table
              columns={columns}
              dataSource={voices || []}
              rowKey="voice_id"
              pagination={false}
              size="small"
              locale={{ emptyText: '暂无可用的语音，请选择其他语言' }}
            />
          )}
        </Card>

        {/* 音效库 */} 
        <Card
          title={<span className="flex items-center gap-2"><FileAudio size={16} className="text-indigo-500" />场景音效库</span>}
        >
          {soundEffects && soundEffects.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {soundEffects.map((effect) => (
                <Card
                  key={effect.effect_id}
                  size="small"
                  hoverable
                  className={`text-center cursor-pointer transition-all ${playingId === effect.effect_id ? 'ring-2 ring-indigo-400' : ''}`}
                  onClick={() => handlePlayEffect(effect)}
                >
                  <div className="py-2">
                    <Music size={20} className={`mx-auto mb-1 ${playingId === effect.effect_id ? 'text-indigo-500' : 'text-indigo-400'}`} />
                    <p className="text-xs font-medium text-slate-700 dark:text-slate-300">{effect.name}</p>
                    <p className="text-[10px] text-slate-400">
                      {playingId === effect.effect_id ? '播放中...' : '点击预览'}
                    </p>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <div className="py-8">
              <Alert
                type="info"
                showIcon
                message="场景音效库开发中"
                description="后端音效资源尚未接入。当前仅支持 TTS 语音合成，音效功能将在后续版本开放。"
                className="mb-6"
              />
              <Empty
                image={<FileAudio size={40} className="text-slate-300 dark:text-slate-600 mx-auto" />}
                description="音效资源接入中，当前可使用 TTS 语音合成"
              />
            </div>
          )}
        </Card>

        <div className="h-8" />
      </div>
    </div>
  );
}
