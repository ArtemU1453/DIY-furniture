/**
 * Ленивая загрузка 3D-сцены (этап 37).
 *
 * Three.js и его обвязка — самая тяжёлая часть сборки. Пользователь, который
 * пришёл за раскроем, спецификацией или документами, не должен скачивать её
 * ради этих разделов, поэтому сцена вынесена в отдельный кусок сборки.
 *
 * Кусок лежит РЯДОМ с приложением (обычный файл сборки, не внешний сервис):
 * после установки всё остаётся локальным. Чтобы переход в 3D не ждал загрузки,
 * кусок подгружается в фоне сразу после первой отрисовки.
 */
import { lazy, Suspense, useEffect, type MutableRefObject } from 'react';

export type { CameraApi } from './Scene3D';

const loadScene = () => import('./Scene3D');

const Scene3DInner = lazy(async () => ({ default: (await loadScene()).Scene3D }));

interface Props {
  showNumbers?: boolean;
  bodyMode?: 'construction' | 'body';
  captureRef?: MutableRefObject<{ capture: () => string } | null>;
  cameraRef?: MutableRefObject<import('./Scene3D').CameraApi | null>;
}

/** Подгрузить сцену заранее, когда браузер свободен. */
export function preloadScene3D(): void {
  void loadScene();
}

/** Фоновая подгрузка после первой отрисовки — вызывать один раз в приложении. */
export function useScene3DPreload(): void {
  useEffect(() => {
    const idle = window.requestIdleCallback?.bind(window);
    if (idle) {
      const handle = idle(() => preloadScene3D());
      return () => window.cancelIdleCallback?.(handle);
    }
    const timer = window.setTimeout(preloadScene3D, 1200);
    return () => window.clearTimeout(timer);
  }, []);
}

export function Scene3D(props: Props) {
  return (
    <Suspense
      fallback={
        <div className="empty-hint" style={{ padding: 20 }} data-testid="scene3d-loading">
          Загрузка 3D…
        </div>
      }
    >
      <Scene3DInner {...props} />
    </Suspense>
  );
}
