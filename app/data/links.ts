export type FriendLink = {
  name: string;
  href: string;
  note: string;
  image: string;
};

export const friendLinks: FriendLink[] = [
  {
    name: "闲时小记",
    href: "https://gaolb.cn/",
    note: "老师的博客",
    image: "/links/xianshi.svg",
  },
  {
    name: "nini",
    href: "http://mengdaozhe.icu/",
    note: "同学的博客",
    image: "/links/nini.png",
  },
];
