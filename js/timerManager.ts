import moment from 'moment';

/**
 * 倒计时配置接口
 * @interface CountdownConfig
 * @property {string} time - 目标时间，格式为标准时间字符串
 * @property {function} onTick - 每秒触发的回调函数，参数为剩余时间字符串
 * @property {function} [onEnd] - 可选的结束回调函数
 */
interface CountdownConfig {
  time: string;
  onTick?: (countdown: string) => void;
  onEnd?: () => void;
}

/**
 * 全局定时器管理器
 * 使用单例模式实现的定时器管理类，用于统一管理多个倒计时实例
 *
 * 主要功能：
 * 1. 全局使用单个定时器，优化性能
 * 2. 自动管理定时器的创建和销毁
 * 3. 支持多个倒计时同时运行
 * 4. 自动清理已结束的倒计时
 *
 * 使用示例：
 * ```typescript
 * // 注册一个倒计时
 * const id = 'my-countdown';
 * TimerManager.getInstance().register(id, {
 *   time: '2024-12-31 23:59:59',
 *   onTick: (countdown) => console.log(countdown),
 *   onEnd: () => console.log('倒计时结束')
 * });
 *
 * // 注销倒计时
 * TimerManager.getInstance().unregister(id);
 * ```
 */
class TimerManager {
  private static instance: TimerManager;

  /** 全局定时器引用 */
  private timer: ReturnType<typeof setInterval> | null = null;

  /** 存储所有倒计时配置的Map */
  private countdowns = new Map<string, CountdownConfig>();

  /**
   * 私有构造函数，初始化定时器
   * @private
   */
  private constructor() {
    this.timer = setInterval(() => {
      this.updateCountdowns();
    }, 1000);
  }

  /**
   * 获取TimerManager单例
   * @returns {TimerManager} TimerManager实例
   */
  static getInstance() {
    if (!TimerManager.instance) {
      TimerManager.instance = new TimerManager();
    }
    return TimerManager.instance;
  }

  /**
   * 更新所有倒计时
   * 每秒执行一次，计算剩余时间并触发回调
   * @private
   */
  private updateCountdowns() {
    this.countdowns.forEach((config, id) => {
      const now = moment();
      const target = moment(config.time);
      const diff = target.diff(now);

      if (diff <= 0) {
        config.onTick?.('已结束');
        config.onEnd?.();
        this.countdowns.delete(id);
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      config.onTick?.(`${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
    });

    // 如果没有倒计时了，清理定时器
    if (this.countdowns.size === 0) {
      this.destroy();
    }
  }

  /**
   * 注册新的倒计时
   * @param {string} id - 倒计时唯一标识
   * @param {CountdownConfig} config - 倒计时配置
   */
  register(id: string, config: CountdownConfig) {
    this.countdowns.set(id, config);
    // 如果定时器被销毁了，重新创建
    if (!this.timer) {
      this.timer = setInterval(() => {
        this.updateCountdowns();
      }, 1000);
    }
  }

  /**
   * 注销指定的倒计时
   * @param {string} id - 要注销的倒计时ID
   */
  unregister(id: string) {
    this.countdowns.delete(id);
  }

  /**
   * 销毁定时器管理器
   * 清除定时器并清空所有倒计时
   */
  destroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.countdowns.clear();
  }
}

export default TimerManager;
