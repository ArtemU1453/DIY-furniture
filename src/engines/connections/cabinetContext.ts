/**
 * Мост между параметрами шкафа (этапы 11–13) и правилами соединений (§27).
 *
 * Шаблонные изделия описываются CabinetParameters, параметрические —
 * ParametricModel. Правила соединений одни и те же, поэтому здесь параметры
 * шкафа переводятся в контекст правил — второй системы соединений не
 * появляется (§1).
 */
import type { HardwareCategory } from '@/core/model/types';
import type { CabinetParameters } from '@/engines/furniture/cabinet';
import type { ConnectionRuleContext } from './rules';

/**
 * Контекст правил из параметров шкафа.
 *
 * Схема корпуса определяется по креплению верха и низа: 'between' — крышка и
 * дно между боковинами, иначе накладные (§30–§32).
 */
export function cabinetConnectionContext(
  params: CabinetParameters,
): Omit<ConnectionRuleContext, 'parts'> {
  return {
    jointCategory: params.jointType as HardwareCategory,
    construction: params.top === 'between' && params.bottom === 'between'
      ? 'BETWEEN_SIDES'
      : 'ON_SIDES',
    handles: params.handleEnabled && params.doors > 0,
  };
}
