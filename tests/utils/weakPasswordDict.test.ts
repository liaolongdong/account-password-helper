import { describe, it, expect } from 'vitest';
import { isCommonPassword, filterCommonPasswords } from '@/utils/weakPasswordDict';

describe('weakPasswordDict', () => {
  describe('isCommonPassword', () => {
    it('应识别常见弱密码（精确匹配）', async () => {
      expect(await isCommonPassword('123456')).toBe(true);
      expect(await isCommonPassword('password')).toBe(true);
      expect(await isCommonPassword('qwerty')).toBe(true);
      expect(await isCommonPassword('admin')).toBe(true);
      expect(await isCommonPassword('letmein')).toBe(true);
    });

    it('应识别常见弱密码（大小写不敏感）', async () => {
      expect(await isCommonPassword('PASSWORD')).toBe(true);
      expect(await isCommonPassword('Password')).toBe(true);
      expect(await isCommonPassword('QWERTY')).toBe(true);
      expect(await isCommonPassword('Admin')).toBe(true);
    });

    it('不应误判强密码', async () => {
      expect(await isCommonPassword('xK9#mZ$2qL@v8N!')).toBe(false);
      expect(await isCommonPassword('MyUn1qu3P@ssw0rd!2024')).toBe(false);
      expect(await isCommonPassword('j8Hn$k2Lm9@pQz')).toBe(false);
    });

    it('空密码应返回 false', async () => {
      expect(await isCommonPassword('')).toBe(false);
    });

    it('多次调用应复用已加载的字典（缓存命中）', async () => {
      // 第一次调用触发 import
      await isCommonPassword('test');
      // 第二次调用走缓存
      const start = performance.now();
      await isCommonPassword('123456');
      const elapsed = performance.now() - start;
      // 缓存命中应极快（< 5ms）
      expect(elapsed).toBeLessThan(5);
    });
  });

  describe('filterCommonPasswords', () => {
    it('应返回命中字典的索引集合', async () => {
      const passwords = ['123456', 'MyStr0ngP@ss!', 'password', '', 'qwerty123'];
      const hits = await filterCommonPasswords(passwords);
      expect(hits.has(0)).toBe(true); // 123456
      expect(hits.has(1)).toBe(false); // 强密码
      expect(hits.has(2)).toBe(true); // password
      expect(hits.has(3)).toBe(false); // 空密码
      expect(hits.has(4)).toBe(true); // qwerty123
    });

    it('空数组应返回空集合', async () => {
      const hits = await filterCommonPasswords([]);
      expect(hits.size).toBe(0);
    });

    it('全为强密码时应返回空集合', async () => {
      const passwords = ['xK9#mZ$2qL@v8N!', 'j8Hn$k2Lm9@pQz', 'Ab3$Fg7&Hj'];
      const hits = await filterCommonPasswords(passwords);
      expect(hits.size).toBe(0);
    });
  });
});
