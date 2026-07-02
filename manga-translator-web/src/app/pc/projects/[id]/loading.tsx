import { Spin } from 'antd';

export default function EditorLoading() {
  return (
    <div className="h-screen flex flex-col items-center justify-center bg-slate-100 dark:bg-slate-950 gap-4">
      <Spin size="large" />
      <p className="text-sm text-slate-500 dark:text-slate-400">正在加载编辑工作台...</p>
    </div>
  );
}
