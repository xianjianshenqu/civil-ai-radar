import {Component, Suspense, lazy} from 'react';

// 按需加载的面板：账号、设置、Agent 中心与管理员视图不进首页主包，访客打开首页时不下载它们。
export const lazyNamed = (load, name) => lazy(() => load().then(module => ({default: module[name]})));

// 发版后旧页面里的分包哈希会 404（服务端对缺失的带扩展名资源诚实返回 404），这里给出刷新入口，而不是整页白屏。
class ChunkBoundary extends Component {
  state = {failed: false};
  static getDerivedStateFromError() { return {failed: true}; }
  render() {
    if (!this.state.failed) return this.props.children;
    const body = <div className="empty-state"><strong>这部分页面没能加载</strong><span>网站可能刚更新过，刷新后即可使用。</span><button type="button" onClick={() => window.location.reload()}>刷新页面</button></div>;
    return this.props.inline ? body : <section className="utility-panel">{body}</section>;
  }
}

// inline：已经在面板里面（如 Agent 中心的管理员分页）时不再套一层面板。
export function LazyPanel({children, inline = false}) {
  const loading = <div className="empty-state" aria-busy="true"><span>加载中…</span></div>;
  return <ChunkBoundary inline={inline}><Suspense fallback={inline ? loading : <section className="utility-panel">{loading}</section>}>{children}</Suspense></ChunkBoundary>;
}
