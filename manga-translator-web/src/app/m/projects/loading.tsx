import { Spin } from 'antd';

export default function MobileProjectsLoading() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Spin size="large" />
    </div>
  );
}
