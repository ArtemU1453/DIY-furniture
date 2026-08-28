/**
 * Граница ошибок (этап 35).
 *
 * Сбой в одном разделе не должен обнулять экран и терять работу: раздел
 * заменяется понятным сообщением, остальное приложение продолжает работать,
 * а проект остаётся в памяти и в автосохранении.
 *
 * Пользователю НЕ показывается стек: техническая часть уходит в консоль
 * разработчика, на экране — что произошло и что можно сделать.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  /** Что именно не открылось: «Раскрой», «3D» и т. п. */
  title?: string;
  children: ReactNode;
}

interface State {
  message: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { message: null };

  static getDerivedStateFromError(error: unknown): State {
    const message = error instanceof Error ? error.message : String(error);
    return { message };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Подробности — разработчику, не пользователю.
    console.error('Ошибка раздела:', error, info.componentStack);
  }

  private reset = () => this.setState({ message: null });

  render(): ReactNode {
    const { message } = this.state;
    if (message === null) return this.props.children;

    return (
      <div style={{ padding: 20, maxWidth: 560 }} role="alert">
        <h3 style={{ margin: '0 0 8px' }}>
          {this.props.title ? `Раздел «${this.props.title}» не открылся` : 'Раздел не открылся'}
        </h3>
        <p style={{ color: 'var(--text-dim)', fontSize: 12, lineHeight: 1.5 }}>
          Проект не потерян: он остаётся в памяти и в автосохранении. Попробуйте
          открыть раздел ещё раз или перейдите в другой.
        </p>
        <p style={{ color: 'var(--text-dim)', fontSize: 12 }}>
          Причина: {message}
        </p>
        <button onClick={this.reset}>Попробовать снова</button>
      </div>
    );
  }
}
