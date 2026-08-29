/**
 * ЭТАП 41 · ПОНЯТНОСТЬ ИНТЕРФЕЙСА.
 *
 * Проверяется не «отрисовалось ли», а понимает ли человек, что произошло:
 * подпись связана с полем, диалог закрывается клавишей и объявляет себя
 * программе чтения с экрана, пустой цех не выдаёт себя за готовый.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NumberField } from '@/components/ui/NumberField';
import { Modal } from '@/components/ui/Modal';
import { useEditorStore } from '@/app/store/editorStore';
import { productionParts, productionReadiness } from '@/engines/production';

afterEach(cleanup);

describe('Этап 41 · подпись поля доступна программно', () => {
  it('§51 подпись связана с полем, поле находится по имени', () => {
    render(<NumberField label="Ширина" suffix="мм" value={600} onCommit={() => {}} />);
    // Поле находится именно по видимой подписи — значит, связь настоящая.
    const input = screen.getByLabelText('Ширина, мм') as HTMLInputElement;
    expect(input.tagName).toBe('INPUT');
    expect(input.value).toBe('600');
  });

  it('§51 два поля на экране получают разные идентификаторы', () => {
    render(
      <>
        <NumberField label="Ширина" suffix="мм" value={600} onCommit={() => {}} />
        <NumberField label="Высота" suffix="мм" value={2000} onCommit={() => {}} />
      </>,
    );
    const width = screen.getByLabelText('Ширина, мм') as HTMLInputElement;
    const height = screen.getByLabelText('Высота, мм') as HTMLInputElement;
    expect(width.id).not.toBe(height.id);
    expect(width.value).toBe('600');
    expect(height.value).toBe('2000');
  });
});

describe('Этап 41 · диалог понятен и закрывается', () => {
  it('§43 Esc закрывает окно', () => {
    const onClose = vi.fn();
    render(<Modal title="Новый проект" onClose={onClose}><button>Создать</button></Modal>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('§51 окно объявляет себя диалогом и называет себя заголовком', () => {
    render(<Modal title="Новый проект" onClose={() => {}}><button>Создать</button></Modal>);
    const dialog = screen.getByRole('dialog', { name: 'Новый проект' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('§44 фокус переходит внутрь окна, а не остаётся на фоне', () => {
    render(<Modal title="Новый проект" onClose={() => {}}><button>Создать</button></Modal>);
    expect(document.activeElement?.textContent).toBe('Создать');
  });

  it('§51 у кнопки закрытия есть имя, а не только значок', () => {
    render(<Modal title="Новый проект" onClose={() => {}}><button>Создать</button></Modal>);
    expect(screen.getByRole('button', { name: 'Закрыть окно' })).toBeTruthy();
  });
});

describe('Этап 41 · пустой цех не выдаёт себя за готовый', () => {
  const store = () => useEditorStore.getState();

  /* Экран цеха выбирает формулировку по числу деталей задания. Проверяется
   * именно это число: «готовность 100%» при нуле деталей — дезинформация. */
  it('§32 в пустом проекте деталей для цеха нет', () => {
    store().newProject('Пустой');
    expect(productionParts(store().project)).toHaveLength(0);
  });

  it('§32 со шкафом детали появляются и готовность снова осмысленна', () => {
    store().newProject('Со шкафом');
    store().createParametricCabinet({ type: 'CABINET', width: 800, height: 2000, depth: 600 });
    const parts = productionParts(store().project);
    expect(parts.length).toBeGreaterThan(0);
    const readiness = productionReadiness(store().project, parts);
    expect(readiness.progress).toBeGreaterThanOrEqual(0);
    expect(readiness.progress).toBeLessThanOrEqual(100);
  });
});
