// 驱动登记处。两个驱动之间零依赖 —— 各管各的协议怪癖,一个改坏了不影响另一个。
import responses from './responses.js';
import chat from './chat.js';

export const DRIVERS = Object.freeze({ [responses.id]: responses, [chat.id]: chat });
export const DRIVER_IDS = Object.freeze(Object.keys(DRIVERS));
export const DEFAULT_DRIVER = responses.id;

export function driverFor(id) {
    const driver = DRIVERS[String(id || DEFAULT_DRIVER)];
    if (!driver) throw new Error(`未知的驱动:${id}(可选:${DRIVER_IDS.join(' / ')})`);
    return driver;
}
