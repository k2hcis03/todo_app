import type { Status } from './schemas';

/** 로그인한 사용자. 화면과 /api/me에 노출해도 되는 값만 담는다 (githubId, 토큰 등은 제외). */
export interface AuthUser {
  id: string;
  username: string;
  avatarUrl: string;
}

// API와 화면이 주고받는 DTO. id는 문자열, 시각은 ISO 문자열이다.
export interface Goal {
  id: string;
  title: string;
  year: number;
  createdAt: string;
  updatedAt: string;
}

export interface Week {
  id: string;
  title: string;
  weekStart: string;
  goalId: string;
  createdAt: string;
  updatedAt: string;
}

export interface WeekWithProgress extends Week {
  total: number;
  done: number;
  /** 0~100, 소수 그대로 (표시는 formatPercent) */
  progress: number;
}

export interface Todo {
  id: string;
  title: string;
  date: string;
  status: Status;
  weekId: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}
