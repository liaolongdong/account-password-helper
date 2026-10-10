import { onMounted, onUnmounted } from 'vue';

/**
 * Element Plus 给模态层上滚动锁时写到 `body` 的类名
 *
 * 它的添加与移除正好成对标记「第一个模态打开」与「最后一个模态关闭」：嵌套模态（对话框上
 * 再盖一个确认框）只在第一个上面加、最后一个关掉才移除。因此按它配对就够，
 * 不必给管理页二十多个模态容器逐个挂 `@open` / `@closed`。
 */
const BODY_LOCK_CLASS = 'el-popup-parent--hidden';

/**
 * 「弹窗期间有一次自己的定位要生效」的意图标记
 *
 * 页面级只有一个 `useModalScrollRestoration()` 实例（`entrypoints/options/App.vue` 的 setup），
 * 而标记的另一侧 `composables/usePasswordManagement.ts` 与本模块没有引用关系，
 * 于是放在模块作用域而非闭包 —— 两处都拿得到，且不需要把回调层层传下去。
 */
let revealIntent = false;

/**
 * 登记一次「由本页面主动发起的滚动定位」，让紧随其后的解锁不再还原弹窗前的偏移
 *
 * `revealRow` 在弹窗**还开着**时就 `scrollIntoView`（保存链路里 `showPasswordDialog = false` 排其后），
 * 那次定位落在文档上、用户要看的行因此进了视口；若解锁时把弹窗前的位置写回去，
 * 高亮行会被推回视口外 —— 还原反而废掉了定位。调用方不需要知道本模块的存在，
 * 只需在定位后打这一颗标记。
 */
export const noteRevealIntent = (): void => {
  revealIntent = true;
};

/**
 * 模态层开关期间保住管理页的滚动位置
 *
 * 实测（Chrome for Testing 153，`e2e/dialog-scroll-isolation.spec.ts`）：打开 `el-dialog` 的一瞬间
 * 文档滚动位置被归零，关掉弹窗也不会自己回来 —— 用户读到的是「滚到第 8 条改一条密码，
 * 保存后列表跳回顶部」。逐层排除后确认成因不在本项目：只往 `body` 加那个锁滚类（连
 * `width: calc(100% - 15px)` 一起加也一样保留偏移），Element Plus 那句 `scrollTop = 0` 写到的
 * 两个元素当时也都是 0；时间线量出来是「文档先归零 → 锁滚类才落到 body」，
 * 所以**不能在加类的瞬间取值**，那份读数永远是 0。
 *
 * 于是取值改由滚动事件本身记账，只在没锁的时候记 —— 归零那一次滚动到达时锁滚类已经落好，
 * 它就被挡在记账之外（MutationObserver 的微任务必定早于那一帧的 scroll 事件）。
 * 解锁时把最后那次合法偏移写回去；列表可能在弹窗期间变短，超出可滚范围时浏览器自行钳位。
 *
 * 两条实测到的边界决定了还原不能无条件做：
 * ① 锁滚**拦不住程序化滚动** —— 弹窗开着时 `scrollIntoView` 照样把文档从 0 推到 1298，
 *    所以「弹窗期间文档一定停在 0」这个想当然的假设不成立，见 `noteRevealIntent`。
 * ② 解锁不等于「没有模态了」 —— 详情抽屉里点编辑（`onDetailEdit` 同一 tick 关抽屉开对话框）
 *    实测 body 最终是**未上锁**的（`style.overflow` 为空）而对话框还开着；这条路径上还原发生在
 *    对话框存续期间，把位置交还给背景列表正是用户此刻要的，因此不改判。
 *
 * 与 `el-drawer` 共用同一个锁滚类，所以抽屉那条路径也一并覆盖了 —— 抽屉实测不丢位置，
 * 还原同值是一次空操作，换来的是不必区分「谁会让浏览器动手」。
 */
export function useModalScrollRestoration(): void {
  let savedTop = 0;
  let locked = false;

  const record = (): void => {
    if (!locked) savedTop = window.scrollY;
  };

  const sync = (): void => {
    const isLocked = document.body.classList.contains(BODY_LOCK_CLASS);
    if (isLocked === locked) return;
    locked = isLocked;
    // 进模态即重新起算：revealRow 在没有模态时也会定位，那次标记不该欠到下一个弹窗。
    if (isLocked) revealIntent = false;
    else if (revealIntent) revealIntent = false;
    else window.scrollTo(0, savedTop);
  };

  const observer = new MutationObserver(sync);

  onMounted(() => {
    locked = document.body.classList.contains(BODY_LOCK_CLASS);
    if (!locked) savedTop = window.scrollY;
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('scroll', record, { passive: true });
  });

  onUnmounted(() => {
    observer.disconnect();
    window.removeEventListener('scroll', record);
  });
}
