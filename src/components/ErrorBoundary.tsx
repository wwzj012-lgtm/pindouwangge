import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  /** 根级边界用：重试等于刷新整页，而不是重渲染同一棵必然再崩的树。 */
  reloadOnReset?: boolean;
}

interface State {
  error: Error | null;
}

/**
 * 真正的 React 错误边界。
 *
 * 旧实现只监听 `window.error`，有两个问题：
 * 1. React 的渲染错误走的是 `getDerivedStateFromError`，不会冒泡成普通的 window 事件，
 *    所以它**从来没有捕获过任何渲染崩溃**，只会被无关的异步错误误伤；
 * 2. 一个和本组件无关的报错（比如某个请求回调抛错）也会把整个子树换成错误卡片。
 *
 * 现在改成 class 边界：只接住自己子树里的渲染/生命周期错误。
 * 根级用法见 `main.tsx` —— 没有它时，任意一处渲染抛错都是整页白屏。
 */
export class ErrorBoundary extends Component {
  // 本项目没有装 @types/react（见 tsconfig/依赖），`Component` 解析为 any，
  // 继承不到 props/setState 的声明，所以这里显式声明它们在运行时的存在。
  declare props: Props;
  declare setState: (state: Partial<State>) => void;
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 堆栈留给控制台/线上日志，界面只显示可读文案
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  /** 把错误信息交给用户/开发者，省掉"截图里只有一句通用文案"的来回。 */
  private handleCopy = () => {
    const { error } = this.state;
    if (!error) return;
    const text = `${error.name}: ${error.message}\n${error.stack ?? ''}`;
    void navigator.clipboard?.writeText(text).catch(() => undefined);
  };

  private handleReset = () => {
    if (this.props.reloadOnReset) {
      window.location.reload();
      return;
    }
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return <>{this.props.children}</>;

    return (
      <div className="flex min-h-[50vh] items-center justify-center p-6">
        <div className="w-full max-w-md space-y-4 rounded-3xl border border-rose-200 bg-white p-6 text-center shadow-xl">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-rose-200 bg-rose-50 text-rose-500">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <h3 className="text-base font-bold text-purple-950">
            {this.props.fallbackTitle || '页面组件加载异常'}
          </h3>
          <p className="text-xs leading-relaxed text-purple-600">
            页面暂时遇到问题，请点击下方按钮重试。
          </p>
          <button
            onClick={this.handleReset}
            className="mx-auto flex items-center justify-center gap-2 rounded-xl bg-purple-600 px-4 py-2 text-xs font-bold text-white transition-all hover:bg-purple-500 cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>{this.props.reloadOnReset ? '刷新页面' : '重新载入此界面'}</span>
          </button>
          {/* 只给"复制"，不在卡片里渲染原始报错：既守住"不泄露内部信息"的既有契约，
              又免得用户只能截一张只有通用文案的图，谁也判断不了是什么崩的。 */}
          <button
            type="button"
            onClick={this.handleCopy}
            className="mx-auto block text-[11px] font-bold text-purple-400 underline underline-offset-2 transition-colors hover:text-purple-600 cursor-pointer"
          >
            复制错误信息
          </button>
        </div>
      </div>
    );
  }
}
