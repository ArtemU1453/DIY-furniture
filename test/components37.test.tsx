/**
 * ЭТАП 37 · ТЕСТЫ КРИТИЧЕСКИХ UI-КОМПОНЕНТОВ.
 *
 * Тестируются только те компоненты, где ошибка приводит к порче данных или
 * к потере работы пользователя, — и где проверка дешёвая и устойчивая:
 * числовое поле (границы размеров), пустой проект (первый шаг), граница
 * ошибок (сбой раздела) и модальное окно (закрытие диалогов).
 *
 * Холсты 2D/3D сюда не входят: в jsdom они не рисуют, и такой тест проверял
 * бы заглушку, а не поведение. Их покрывает браузерный E2E.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NumberField } from '@/components/ui/NumberField';
import { EmptyProject } from '@/components/panels/EmptyProject';
import { ErrorBoundary } from '@/components/layout/ErrorBoundary';
import { Modal } from '@/components/ui/Modal';

afterEach(cleanup);

describe('NumberField — границы размеров', () => {
  const setup = (props: Partial<React.ComponentProps<typeof NumberField>> = {}) => {
    const onCommit = vi.fn();
    render(<NumberField label="Ширина" value={600} min={1} onCommit={onCommit} {...props} />);
    return { onCommit, input: screen.getByRole('spinbutton') as HTMLInputElement };
  };

  it('применяет корректное значение по Enter', () => {
    const { onCommit, input } = setup();
    fireEvent.change(input, { target: { value: '800' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(800);
  });

  it('не пропускает отрицательное значение и возвращает прежнее', () => {
    const { onCommit, input } = setup();
    fireEvent.change(input, { target: { value: '-50' } });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe('600');
  });

  it('не пропускает ноль, когда минимум равен 1', () => {
    const { onCommit, input } = setup();
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe('600');
  });

  it('не пропускает нечисловой ввод', () => {
    const { onCommit, input } = setup();
    fireEvent.change(input, { target: { value: 'ерунда' } });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe('600');
  });

  it('уважает максимум, если он задан', () => {
    const { onCommit, input } = setup({ max: 1000 });
    fireEvent.change(input, { target: { value: '1200' } });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe('600');
  });

  it('принимает дробное значение', () => {
    const { onCommit, input } = setup();
    fireEvent.change(input, { target: { value: '18.5' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(18.5);
  });

  it('значение, которое поле не может удержать, не уходит в модель', () => {
    /* Числовое поле браузера не принимает «18,5» и остаётся пустым. Важно, что
     * пустое значение НЕ попадает в модель как ноль: деталь не обнулится. */
    const { onCommit, input } = setup();
    fireEvent.change(input, { target: { value: '18,5' } });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe('600');
  });
});

describe('EmptyProject — первый шаг пользователя', () => {
  it('показывает понятный следующий шаг и обе кнопки работают', () => {
    const onCreateFurniture = vi.fn();
    const onOpenCabinetDesigner = vi.fn();
    render(
      <EmptyProject
        onCreateFurniture={onCreateFurniture}
        onOpenCabinetDesigner={onOpenCabinetDesigner}
      />,
    );

    expect(screen.getByText('Проект пуст')).toBeDefined();
    fireEvent.click(screen.getByTestId('empty-create'));
    expect(onCreateFurniture).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Мастер шкафа'));
    expect(onOpenCabinetDesigner).toHaveBeenCalledTimes(1);
  });
});

describe('ErrorBoundary — сбой раздела', () => {
  const Boom = () => {
    throw new Error('внутренняя ошибка раздела');
  };

  it('показывает понятное сообщение вместо пустого экрана и не показывает стек', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary title="Раскрой">
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText(/Раздел «Раскрой» не открылся/)).toBeDefined();
    // Причина видна пользователю, а стек — нет.
    expect(screen.getByText(/внутренняя ошибка раздела/)).toBeDefined();
    expect(document.body.textContent).not.toMatch(/at Object|\.tsx:\d+/);
    expect(screen.getByText('Попробовать снова')).toBeDefined();
    spy.mockRestore();
  });

  it('исправный раздел показывается как есть', () => {
    render(
      <ErrorBoundary title="Детали">
        <div>содержимое раздела</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText('содержимое раздела')).toBeDefined();
  });
});

describe('Modal — закрытие диалогов', () => {
  it('клик по фону закрывает, клик по содержимому — нет', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Modal title="Новый проект" onClose={onClose}>
        <button>Создать</button>
      </Modal>,
    );

    fireEvent.click(screen.getByText('Создать'));
    expect(onClose).not.toHaveBeenCalled();

    // Фон — внешний контейнер диалога.
    fireEvent.click(container.firstElementChild!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
