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
    note: "高老师",
    image: "/links/xianshi.svg",
  },
  {
    name: "nini",
    href: "http://mengdaozhe.icu/",
    note: "同学的博客",
    image: "/links/nini.png",
  },
  {
    name: "侯君谦成神计划",
    href: "https://www.hackhbaby.online/",
    note: "田总的博客",
    image: "/links/hackhbaby.svg",
  },
];
