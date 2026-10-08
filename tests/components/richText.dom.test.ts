/** @vitest-environment jsdom */

/**
 * 富文本渲染器的 DOM 契约测试
 *
 * 帮助弹窗与文档中页用它替换了 `v-html`，这条测试守的是替换的前提：
 * **宿主的 DOM 必须与 `v-html` 的输出逐节点一致**。三件事缺一不可——返回值是 Fragment
 * （不能插包装节点，否则 `<li>` 里多一层 `<span>`）、白名单外标记成为可见文本而非节点
 * （安全属性）、动态元素不带 class 与 data-v（样式必须由宿主按后代选择器负责）。
 *
 * 口径说明：这里挂载的是 `components/RichText.vue` 所调用的同一个 `toRichTextVNodes`，
 * 而不是 SFC 本身——本仓的 Vitest 管线没有 `@vitejs/plugin-vue`（`WxtVitest()` 不注册
 * 编译器，`node_modules/@vitejs` 那份是 pnpm 不管理的四月遗留副本），import `.vue` 会直接
 * 报 "Install @vitejs/plugin-vue"。SFC 外壳只剩 props 到 render 的一行接线，
 * 由 `pnpm build` 与真机加载覆盖。
 */
import { describe, it, expect } from 'vitest';
import { createApp, nextTick, ref } from 'vue';
import { toRichTextVNodes } from '@/utils/richText';

/**
 * 宿主组件工厂
 *
 * 两处挂载共用同一份组件形态（一个只有 render 的匿名宿主），文件里因此只声明一种组件
 * ——`vue/one-component-per-file` 的额度正落在这一处。取值走回调，最后一次用例
 * 才能在改 `ref` 之后看到重渲染。
 */
const hostComponent = (getSource: () => string) => ({
  render: () => toRichTextVNodes(getSource()),
});

/** 把 source 渲染进一个游离的 `<li>`（与调用方的宿主节点一致），返回该 `<li>` */
async function renderIntoLi(source: string): Promise<HTMLLIElement> {
  const li = document.createElement('li');
  const app = createApp(hostComponent(() => source));
  app.mount(li);
  await nextTick();
  return li;
}

describe('富文本渲染器的 DOM 输出', () => {
  it('白名单标记成为元素，文本直接挂在宿主下，没有包装元素', async () => {
    const li = await renderIntoLi('按 <code>Ctrl+K</code> 唤出，<b>仅此一次</b>。');

    // 只断言元素与文本，不断言 childNodes 数量：Vue 给 Fragment 根补首尾两个空文本锚点
    // （runtime-core 挂载 fragment 根组件时 `insert(createText(""))`），
    // 空文本对排版、选择器与读数全无影响，innerHTML 与文本口径与 v-html 一致即可。
    expect(li.children).toHaveLength(2);
    expect(li.textContent).toBe('按 Ctrl+K 唤出，仅此一次。');
    expect(li.innerHTML).toBe('按 <code>Ctrl+K</code> 唤出，<b>仅此一次</b>。');
    expect(li.querySelector('span')).toBeNull();
  });

  it('白名单之外的写法成为可见字面文本，不产生任何可执行节点', async () => {
    const li = await renderIntoLi('<img src=x onerror=alert(1)><script>evil()</script>');

    expect(li.children).toHaveLength(0);
    expect(li.textContent).toBe('<img src=x onerror=alert(1)><script>evil()</script>');
    expect(li.innerHTML).toBe('&lt;img src=x onerror=alert(1)&gt;&lt;script&gt;evil()&lt;/script&gt;');
  });

  it('标签属性被丢弃，动态元素不带 class 与 data-v', async () => {
    const li = await renderIntoLi('<code class="x" onclick="evil()">a</code>');
    const code = li.querySelector('code');

    expect(code).not.toBeNull();
    expect(code?.attributes).toHaveLength(0);
    expect(code?.textContent).toBe('a');
  });

  it('实体引用解码后仍是文本，`&lt;` 不会被重新解析成标签', async () => {
    const li = await renderIntoLi('本机时钟须准确（误差 &lt; 30 秒）');

    expect(li.children).toHaveLength(0);
    expect(li.textContent).toBe('本机时钟须准确（误差 < 30 秒）');
  });

  it('未闭合与交叉闭合按浏览器口径补全，不吞掉文本', async () => {
    expect((await renderIntoLi('<b>a<code>c')).innerHTML).toBe('<b>a<code>c</code></b>');
    expect((await renderIntoLi('<code><b>x</code>y')).innerHTML).toBe('<code><b>x</b></code>y');
  });

  it('source 变化时随重渲染更新（语言切换口径）', async () => {
    const li = document.createElement('li');
    const source = ref('<b>中</b>');
    const app = createApp(hostComponent(() => source.value));
    app.mount(li);
    await nextTick();
    expect(li.innerHTML).toBe('<b>中</b>');

    source.value = '<code>英</code>';
    await nextTick();
    expect(li.innerHTML).toBe('<code>英</code>');
    app.unmount();
  });
});
