/**
 * useMessage - 获取 <AntApp> 上下文中的 message 实例
 * 
 * 替代 `import { message } from 'antd'` 静态导入，消除警告：
 * "Static function can not consume context like dynamic theme"
 * 
 * 用法:
 *   const message = useMessage();
 *   message.success('操作成功');
 */
import { App } from 'antd';
import type { MessageInstance } from 'antd/es/message/interface';

export function useMessage(): MessageInstance {
  const { message } = App.useApp();
  return message;
}

export { App };
