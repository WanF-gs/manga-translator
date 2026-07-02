'use client';

import React, { useEffect, useState } from 'react';
import { message, Spin } from 'antd';
import { X, BookmarkPlus, Volume2, Check } from 'lucide-react';
import clsx from 'clsx';
import { readerApi, type WordDefinition } from '@/services/reader';

interface WordLookupPopupProps {
  /** 要查询的单词 */
  word: string;
  /** 语言，默认 ja */
  lang?: string;
  /** 来源作品，用于加入生词本时记录 */
  sourceProjectId?: string;
  /** 弹窗锚点位置（相对视口） */
  anchor: { x: number; y: number };
  onClose: () => void;
}

/** §2.7.4 单词即点即译弹窗：释义 + 词性 + 例句 + 一键加入生词本 */
export const WordLookupPopup: React.FC<WordLookupPopupProps> = ({
  word,
  lang = 'ja',
  sourceProjectId,
  anchor,
  onClose,
}) => {
  const [loading, setLoading] = useState(true);
  const [def, setDef] = useState<WordDefinition | null>(null);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setAdded(false);
    readerApi
      .lookupWord(word, lang)
      .then((res) => {
        if (alive) setDef(res.data.data);
      })
      .catch(() => {
        if (alive) setDef(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [word, lang]);

  const handleSpeak = () => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      message.info('当前浏览器不支持语音朗读');
      return;
    }
    const u = new SpeechSynthesisUtterance(word);
    u.lang = lang === 'ja' ? 'ja-JP' : lang === 'ko' ? 'ko-KR' : 'en-US';
    window.speechSynthesis.speak(u);
  };

  const handleAdd = async () => {
    if (!def) return;
    try {
      await readerApi.addVocab({
        word: def.word,
        language: lang,
        reading: def.reading,
        meaning: def.definitions.join('；') || def.message || word,
        part_of_speech: def.pos,
        source_project_id: sourceProjectId,
      });
      setAdded(true);
      message.success('已加入生词本');
    } catch {
      message.error('加入生词本失败');
    }
  };

  // 弹窗不遮挡当前阅读位置：优先显示在锚点上方偏移
  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(Math.max(12, anchor.x - 140), (typeof window !== 'undefined' ? window.innerWidth : 1000) - 292),
    top: Math.max(12, anchor.y - 20),
    width: 280,
    zIndex: 1000,
  };

  return (
    <>
      {/* 点击遮罩关闭 */}
      <div className="fixed inset-0 z-[999]" onClick={onClose} />
      <div
        style={style}
        className="rounded-xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-start justify-between gap-2 px-3 pt-3 pb-2 bg-gradient-to-r from-primary-50 to-transparent dark:from-primary-900/20">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-slate-800 dark:text-slate-100 truncate">{word}</span>
              <button onClick={handleSpeak} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 shrink-0" title="朗读">
                <Volume2 size={14} />
              </button>
            </div>
            {def?.reading && (
              <div className="text-xs text-primary-600 dark:text-primary-400 mt-0.5">
                {def.reading}
                {def.romaji ? <span className="text-slate-400 ml-1">[{def.romaji}]</span> : null}
              </div>
            )}
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 shrink-0">
            <X size={15} />
          </button>
        </div>

        {/* 内容 */}
        <div className="px-3 pb-3 max-h-64 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-6">
              <Spin size="small" />
            </div>
          ) : !def ? (
            <p className="text-xs text-slate-400 py-3">查询失败，请稍后再试</p>
          ) : (
            <>
              {def.pos && (
                <span className="inline-block text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 mb-1.5">
                  {def.pos}
                </span>
              )}
              {def.definitions.length > 0 ? (
                <ol className="space-y-1 mb-2">
                  {def.definitions.map((d, i) => (
                    <li key={i} className="text-sm text-slate-700 dark:text-slate-200 leading-snug">
                      <span className="text-slate-400 mr-1">{i + 1}.</span>
                      {d}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-xs text-amber-500 mb-2">{def.message || '未找到释义，仅提供读音'}</p>
              )}

              {def.examples.length > 0 && (
                <div className="mt-2 space-y-1.5 border-t border-slate-100 dark:border-slate-800 pt-2">
                  {def.examples.map((ex, i) => (
                    <div key={i} className="text-xs">
                      {ex.ja && <div className="text-slate-600 dark:text-slate-300">{ex.ja}</div>}
                      {ex.zh && <div className="text-slate-400">{ex.zh}</div>}
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={handleAdd}
                disabled={added}
                className={clsx(
                  'mt-3 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-colors',
                  added
                    ? 'bg-green-50 dark:bg-green-900/30 text-green-600'
                    : 'bg-primary-500 hover:bg-primary-600 text-white'
                )}
              >
                {added ? <Check size={14} /> : <BookmarkPlus size={14} />}
                {added ? '已加入生词本' : '加入生词本'}
              </button>
              {def.source && (
                <div className="text-[10px] text-slate-300 dark:text-slate-600 text-right mt-1.5">
                  来源: {def.source}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
};
