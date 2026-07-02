'use client';

import React, { useState } from 'react';
import { Database, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react';
import clsx from 'clsx';

interface MemoryMatch {
  source: string;
  target: string;
  similarity: number; // 0-100
  fromProject?: string;
  timestamp?: string;
}

interface TranslationMemoryBadgeProps {
  matches: MemoryMatch[];
  className?: string;
}

/** 翻译记忆匹配标记组件 */
export const TranslationMemoryBadge: React.FC<TranslationMemoryBadgeProps> = ({
  matches,
  className,
}) => {
  const [expanded, setExpanded] = useState(false);

  if (matches.length === 0) return null;

  const bestMatch = matches[0];

  return (
    <div className={clsx('mt-2', className)}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors"
      >
        <Database size={10} />
        <span>来自缓存</span>
        <span className="text-purple-400">({bestMatch.similarity}% 匹配)</span>
        {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          {matches.map((match, idx) => (
            <div
              key={idx}
              className="p-2 rounded-lg bg-purple-50/50 dark:bg-purple-900/10 border border-purple-100 dark:border-purple-800 text-xs"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-purple-700 dark:text-purple-400">
                  {match.similarity}% 匹配
                </span>
                {match.fromProject && (
                  <span className="text-[10px] text-slate-400">
                    来自: {match.fromProject}
                  </span>
                )}
              </div>
              <div className="space-y-1">
                <div className="flex items-start gap-2">
                  <span className="text-[10px] text-slate-400 flex-shrink-0">原文:</span>
                  <span className="text-slate-600 dark:text-slate-400">{match.source}</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-[10px] text-slate-400 flex-shrink-0">译文:</span>
                  <span className="text-purple-600 dark:text-purple-400">{match.target}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
