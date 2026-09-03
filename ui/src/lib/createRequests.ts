// 「让 AI 造一个组件 / 应用」:动作住在 PanelHost(要开对话、发提示词),别处只管喊一声。
export const CREATE_WIDGET_EVENT = "worktop:create-widget";
export const CREATE_APP_EVENT = "worktop:create-app";
export const requestCreateWidget = () => window.dispatchEvent(new Event(CREATE_WIDGET_EVENT));
export const requestCreateApp = () => window.dispatchEvent(new Event(CREATE_APP_EVENT));
