import { v4 as uuidv4 } from 'uuid';
import logger from './logger.ts';

/**
 * 任务状态枚举
 */
export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * 任务类型枚举
 */
export type TaskType = 'image_generation' | 'image_composition' | 'video_generation';

/**
 * 任务接口
 */
export interface Task {
  /** 任务唯一 ID */
  task_id: string;
  /** 任务类型 */
  type: TaskType;
  /** 任务状态 */
  status: TaskStatus;
  /** 进度百分比 (0-100) */
  progress: number;
  /** 创建时间 (unix timestamp) */
  created_at: number;
  /** 更新时间 (unix timestamp) */
  updated_at: number;
  /** 完成时间 (unix timestamp, 可选) */
  completed_at?: number;
  /** 任务结果 (完成后填充) */
  result?: any;
  /** 错误信息 (失败后填充) */
  error?: string;
  /** 原始请求参数 (用于回溯) */
  params?: any;
}

/**
 * 任务管理器 - 内存存储 + 后台执行
 *
 * 提供异步任务的创建、查询、清理功能。
 * 任务存储在内存中，进程重启后丢失。
 */
class TaskManager {
  /** 任务存储 Map */
  private tasks: Map<string, Task> = new Map();

  /** 已完成任务的最大保留时间 (毫秒)，默认 2 小时 */
  private readonly COMPLETED_TTL = 2 * 60 * 60 * 1000;

  /** 清理定时器间隔 (毫秒)，默认 10 分钟 */
  private readonly CLEANUP_INTERVAL = 10 * 60 * 1000;

  constructor() {
    // 定时清理过期任务
    setInterval(() => this.cleanup(), this.CLEANUP_INTERVAL);
    logger.info('TaskManager initialized');
  }

  /**
   * 创建新任务并立即在后台执行
   *
   * @param type 任务类型
   * @param executor 实际执行函数，返回结果
   * @param params 原始请求参数（可选，用于回溯）
   * @returns 创建的任务信息（不含 result）
   */
  create(type: TaskType, executor: () => Promise<any>, params?: any): Task {
    const now = Math.floor(Date.now() / 1000);
    const task: Task = {
      task_id: uuidv4(),
      type,
      status: 'pending',
      progress: 0,
      created_at: now,
      updated_at: now,
      params,
    };

    this.tasks.set(task.task_id, task);
    logger.info(`Task created: ${task.task_id} (${type})`);

    // 后台执行，不阻塞返回
    this.execute(task.task_id, executor);

    return { ...task };
  }

  /**
   * 查询任务
   */
  get(taskId: string): Task | undefined {
    const task = this.tasks.get(taskId);
    return task ? { ...task } : undefined;
  }

  /**
   * 列出所有任务（可按状态过滤）
   */
  list(status?: TaskStatus): Task[] {
    const tasks = Array.from(this.tasks.values());
    const filtered = status ? tasks.filter(t => t.status === status) : tasks;
    return filtered
      .sort((a, b) => b.created_at - a.created_at)
      .map(t => ({ ...t }));
  }

  /**
   * 获取统计信息
   */
  stats(): { total: number; pending: number; processing: number; completed: number; failed: number } {
    const tasks = Array.from(this.tasks.values());
    return {
      total: tasks.length,
      pending: tasks.filter(t => t.status === 'pending').length,
      processing: tasks.filter(t => t.status === 'processing').length,
      completed: tasks.filter(t => t.status === 'completed').length,
      failed: tasks.filter(t => t.status === 'failed').length,
    };
  }

  /**
   * 后台执行任务
   */
  private async execute(taskId: string, executor: () => Promise<any>): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    // 更新为 processing
    task.status = 'processing';
    task.progress = 10;
    task.updated_at = Math.floor(Date.now() / 1000);

    logger.info(`Task started: ${taskId}`);

    try {
      const result = await executor();

      // 成功
      task.status = 'completed';
      task.progress = 100;
      task.result = result;
      task.completed_at = Math.floor(Date.now() / 1000);
      task.updated_at = task.completed_at;

      const elapsed = task.completed_at - task.created_at;
      logger.info(`Task completed: ${taskId}, elapsed: ${elapsed}s`);
    } catch (error: any) {
      // 失败
      task.status = 'failed';
      task.error = error.message || 'Unknown error';
      task.updated_at = Math.floor(Date.now() / 1000);

      logger.error(`Task failed: ${taskId}, error: ${task.error}`);
    }
  }

  /**
   * 清理过期的已完成/已失败任务
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [taskId, task] of this.tasks) {
      if (task.status === 'completed' || task.status === 'failed') {
        const taskAge = now - task.updated_at * 1000;
        if (taskAge > this.COMPLETED_TTL) {
          this.tasks.delete(taskId);
          cleaned++;
        }
      }
    }

    if (cleaned > 0) {
      logger.info(`TaskManager cleanup: removed ${cleaned} expired tasks, ${this.tasks.size} remaining`);
    }
  }
}

export default new TaskManager();
