import {
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  type DragEndEvent,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import { STATUSES, STATUS_LABEL, type Status } from '@/lib/schemas';

/** 포인터가 컬럼 안에 있으면 그 컬럼을, 키보드 드래그처럼 포인터가 없으면 겹치는 영역으로 판정한다. */
export const columnCollision: CollisionDetection = (args) => {
  const withinPointer = pointerWithin(args);
  return withinPointer.length > 0 ? withinPointer : rectIntersection(args);
};

const NEXT_KEYS = ['ArrowRight', 'ArrowDown'];
const PREV_KEYS = ['ArrowLeft', 'ArrowUp'];

/**
 * 키보드 드래그: 방향키로 컬럼 순서(할 일 → 진행 중 → 완료)에 따라 이웃 컬럼으로 이동한다.
 * 기본 구현은 25px씩 움직여 컬럼 간 이동이 매우 번거롭다. 좌표가 아니라 컬럼 순서를 기준으로 하므로,
 * 좁은 화면에서 컬럼이 세로로 쌓여도 같은 키로 동작한다. 컬럼 안의 순서 변경은 P1 범위다.
 */
export const columnCoordinateGetter: KeyboardCoordinateGetter = (
  event,
  { context: { droppableRects, collisionRect } },
) => {
  const forward = NEXT_KEYS.includes(event.code);
  if (!forward && !PREV_KEYS.includes(event.code)) return undefined;
  if (!collisionRect) return undefined;
  event.preventDefault();

  // 드래그 중인 카드의 중심이 들어 있는 컬럼이 현재 컬럼이다.
  const centerX = collisionRect.left + collisionRect.width / 2;
  const centerY = collisionRect.top + collisionRect.height / 2;
  const current = STATUSES.findIndex((status) => {
    const rect = droppableRects.get(status);
    return rect && centerX >= rect.left && centerX <= rect.right && centerY >= rect.top && centerY <= rect.bottom;
  });
  if (current === -1) return undefined;

  const target = droppableRects.get(STATUSES[current + (forward ? 1 : -1)]);
  if (!target) return undefined;
  return { x: target.left, y: target.top };
};

/** 드롭 대상이 컬럼(상태)이면 그 상태를 반환한다. */
export function dropTargetStatus(event: DragEndEvent): Status | undefined {
  const id = event.over?.id;
  return STATUSES.find((status) => status === id);
}

// 스크린리더 안내 (dnd-kit 기본 문구는 영어)
const label = (id: string | number, titles: Map<string, string>) => titles.get(String(id)) ?? '할 일';
const columnName = (id: string | number | undefined) => STATUS_LABEL[id as Status] ?? '영역 밖';

export function koreanAccessibility(titles: Map<string, string>) {
  return {
    screenReaderInstructions: {
      draggable:
        '이동하려면 스페이스바나 엔터를 눌러 잡고, 방향키로 이웃 컬럼으로 옮긴 뒤 스페이스바로 놓으세요. 취소하려면 Esc를 누르세요.',
    },
    announcements: {
      onDragStart: ({ active }: { active: { id: string | number } }) => `${label(active.id, titles)} 카드를 잡았습니다.`,
      onDragOver: ({ active, over }: { active: { id: string | number }; over: { id: string | number } | null }) =>
        `${label(active.id, titles)} 카드가 ${columnName(over?.id)} 위에 있습니다.`,
      onDragEnd: ({ active, over }: { active: { id: string | number }; over: { id: string | number } | null }) =>
        over
          ? `${label(active.id, titles)} 카드를 ${columnName(over.id)}에 놓았습니다.`
          : `${label(active.id, titles)} 카드를 원래 자리에 두었습니다.`,
      onDragCancel: ({ active }: { active: { id: string | number } }) => `${label(active.id, titles)} 이동을 취소했습니다.`,
    },
  };
}
