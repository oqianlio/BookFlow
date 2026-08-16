import { Component, type ReactNode } from "react";
import { logFrontend } from "../services/api";

interface Props {
  children: ReactNode;
  /** 发生错误时的兜底 UI 标题（默认"页面出错了"） */
  fallbackTitle?: string;
}

interface State {
  error: Error | null;
}

/**
 * 渲染错误边界：组件树崩溃时显示兜底 UI 并自动写入开发者日志（含组件栈），
 * 避免整棵应用白屏。点击"重试"清空错误重新渲染。
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // 写入开发者日志（前端 console 劫持 → app.log），含组件栈方便定位
    const stack = info.componentStack ?? "";
    logFrontend("error", `ErrorBoundary: ${error.message}\n${stack}`).catch(() => {});
  }

  private reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <div className="error-boundary">
          <h2>{this.props.fallbackTitle ?? "页面出错了"}</h2>
          <pre className="error-boundary-msg">{String(this.state.error.message || this.state.error)}</pre>
          <p className="error-boundary-hint">错误详情已写入「设置 → 开发者日志」</p>
          <div className="error-boundary-actions">
            <button className="btn btn-primary" onClick={this.reset}>重试</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
