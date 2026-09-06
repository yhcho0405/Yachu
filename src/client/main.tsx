import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './style.css';

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="fatal-error">
        <h1>잠시 테이블을 정리하고 있어요.</h1>
        <p>화면을 다시 열면 서버에 저장된 기록으로 돌아올 수 있어요.</p>
        <button className="button primary" onClick={() => location.reload()}>
          다시 연결하기
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
