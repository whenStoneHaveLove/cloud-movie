/**
 * Scraper - 智能元数据刮削引擎
 * 支持拼音识别、多策略搜索、模糊匹配、智能重试、手动修正
 */
const Scraper = (() => {
    const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';
    const POSTER_SIZE = 'w500';
    const BACKDROP_SIZE = 'w1280';
    const PROFILE_SIZE = 'w185';

    const FILE_QUALITY_KEYWORDS = /(?:1080|720|4[Kk]|2160|[Hh]D|[Bb]lu-?[Rr]ay|WEB|HDTV|DVDRip|国语|粤语|日语|韩语|英语|中字|字幕|双语|原声)/i;

    // Generic folder names to skip when extracting titles
    const SKIP_FOLDERS = new Set([
        '网盘视频资源', '电视剧', '电影', '动漫', '综艺', '歌曲',
        '豆瓣TOP250电影', '纪录片', '视频', '影视', '资源',
        '高清', '超清', '4K', '合集', '系列', '更新中',
        '国语版', '粤语版', '日语版', '英语版', '中字版',
    ]);

    // 网盘文件夹名 → TMDB 标准搜索名（带年份）
    // 匹配到的直接走标准名，避免拼音、变形字符导致的搜索偏差
    const MEDIA_NAME_MAP = {
        "恋爱先生 2018": "恋爱先生 (2018)",
        "山海qing2021": "山海情 (2021)",
        "【2019.6.27】长安十二时辰4K": "长安十二时辰 (2019)",
        "腾空的日子 2014": "腾空的日子 (2014)",
        "去有风的地方2023刘亦菲": "去有风的地方 (2023)",
        "摩登家庭2009": "摩登家庭 (2009)",
        "莲花楼 2023": "莲花楼 (2023)",
        "康熙王朝2001": "康熙王朝 (2001)",
        "征服2003": "征服 (2003)",
        "新白娘子传奇-1992": "新白娘子传奇 (1992)",
        "血色浪漫 2004": "血色浪漫 (2004)",
        "西YouJi-1986版": "西游记 (1986)",
        "大jiang大he（1+2）2018": "大江大河 (2018)",
        "家有儿女4部2005": "家有儿女 (2005)",
        "大宅门1-2-2001": "大宅门 (2001)",
        "恰tong学少nian2007": "恰同学少年 (2007)",
        "庆余年 4K(46集全 完结)": "庆余年 (2019)",
        "21胜者即是正义 Legal High （1-2季+SP）": "胜者即是正义 (2012)",
        "切尔N贝利2019": "切尔诺贝利 (2019)",
        "茶-馆2010陈宝国-豆瓣9.3": "茶馆 (2010)",
        "亮Jian-2005": "亮剑 (2005)",
        "我爱wo家1993": "我爱我家 (1993)",
        "闯关东2008": "闯关东 (2008)",
        "鹿鼎记 1998陈小春": "鹿鼎记 (1998)",
        "沉默的真相〖9.0〗2020": "沉默的真相 (2020)",
        "白夜zhui凶2017": "白夜追凶 (2017)",
        "我们与恶的距离〖9.4〗2019": "我们与恶的距离 (2019)",
        "伪装者2015胡歌": "伪装者 (2015)",
        "似水年华2003": "似水年华 (2003)",
        "武林外传4K珍藏版2006": "武林外传 (2006)",
        "贞观之治2006": "贞观之治 (2006)",
        "遇丨见王沥川 2016": "遇见王沥川 (2016)",
        "觉xing年代2021": "觉醒年代 (2021)",
        "琅琊Bang2015": "琅琊榜 (2015)",
        "走向共和2003": "走向共和 (2003)",
        "重启人生2023": "重启人生 (2023)",
        "我们的父辈2013": "我们的父辈 (2013)",
        "《我是大哥大》电视剧+TV+SP+电影版": "我是大哥大 (2018)",
        "我的团长我的团-2009": "我的团长我的团 (2009)",
        "甄嬛传 4K-2011": "甄嬛传 (2011)",
        "最好的我们2014刘昊然": "最好的我们 (2016)",
        "P产姐妹": "破产姐妹 (2011)",
        "西部世界2016": "西部世界 (2016)",
        "山河ling2021": "山河令 (2021)",
        "秘密sen林2017": "秘密森林 (2017)",
        "深夜食堂2009": "深夜食堂 (2009)",
        "kuang飙 2023": "狂飙 (2023)",
        "你好旧shi光2017": "你好旧时光 (2017)",
        "最后生还者2023": "最后生还者 (2023)",
        "余罪1-2": "余罪 (2016)",
        "听见你的声音1080P（2013）": "听见你的声音 (2013)",
        "问xin（4k）": "问心 (2023)",
        "365-逆z命运的1年（2020）": "365：逆转命运的1年 (2020)",
        "不良执念清除师2023": "不良执念清除师 (2023)",
        "棋魂2020(胡先煦)": "棋魂 (2020)",
        "后翼弃兵2020": "后翼弃兵 (2020)",
        "旺达幻视【2021】": "旺达幻视 (2021)",
        "知否知否应是绿肥红瘦DVD版.全78集.4K": "知否知否应是绿肥红瘦 (2018)",
        "古相思qu [2023]": "古相思曲 (2023)",
        "傲慢yu偏见 BBC1995": "傲慢与偏见 (1995)",
        "兄弟lian2001": "兄弟连 (2001)",
        "潜伏2008孙红雷": "潜伏 (2009)",
        "白lu原2017": "白鹿原 (2017)",
        "红楼梦 (1987)  陈晓旭": "红楼梦 (1987)",
        "汉武大帝 2004": "汉武大帝 (2005)",
        "士兵突击 4K 2006": "士兵突击 (2006)",
        "十月围城2014钟汉良": "十月围城 (2014)",
        "想见你2019": "想见你 (2019)",
        "天龙八部 1997 国语": "天龙八部 (1997)",
        "地下交通站2007": "地下交通站 (2007)",
        "Zhan长沙【2014】": "战长沙 (2014)",
        "W我丨可能不会爱你2011": "我可能不会爱你 (2011)",
        "神diao侠侣-古天乐版1995": "神雕侠侣 (1995)",
        "隐M的角落 (2020)": "隐秘的角落 (2020)",
        "天道2008王志文": "天道 (2008)",
        "三国演义 【1994版】": "三国演义 (1994)",
        "父母Ai情2014": "父母爱情 (2014)",
        "大明王朝1566": "大明王朝1566 (2007)",
        "警察荣誉2022": "警察荣誉 (2022)",
        "三Ti(剧版)2023": "三体 (2023)",
        "越狱2005PrisonBreak": "越狱 (2005)",
        "绝m毒师": "绝命毒师 (2008)",
        "人世间2022-雷佳音": "人世间 (2022)",
        "梦华录 40集全": "梦华录 (2022)",
        "御赐小仵作36集": "御赐小仵作 (2021)",
        "我们这一天": "我们这一天 (2016)",
        "以你的心情释我的爱": "以你的心诠释我的爱 (2020)",
        "人民的名义": "人民的名义 (2017)",
        "活着": "活着 (1994)",
        "机智牢房生活": "机智牢房生活 (2017)",
        // ===== 豆瓣电影（文件名精确匹配）=====
        "199.东京教父.mp4": "东京教父 (2001)",
        "193.贫民窟的百万富翁.rmvb": "贫民窟的百万富翁 (2008)",
        "194.恐怖游轮.mp4": "恐怖游轮 (2009)",
        "197.魔女宅急便.mkv": "魔女宅急便 (1989)",
        "195.东邪西毒.国粤双语可切换音轨.mkv": "东邪西毒 (1994)",
        "205.城市之光（卓别林）.mkv": "城市之光 (1931)",
        "202.真爱至上.mkv": "真爱至上 (2003)",
        "203.黑天鹅.mp4": "黑天鹅 (2010)",
        "196.牯岭街少年杀人事件.mkv": "牯岭街少年杀人事件 (1991)",
        "204.可可西里.mp4": "可可西里 (2004)",
        "192.冰川时代.国英双语可切换音轨.mp4": "冰川时代 (2002)",
        "191.爆裂鼓手.mp4": "爆裂鼓手 (2014)",
        "198.遗愿清单.mp4": "遗愿清单 (2007)",
        "200.大佛普拉斯.mp4": "大佛普拉斯 (2017)",
        "190.无敌破坏王.mkv": "无敌破坏王 (2012)",
        "178.记忆碎片.mkv": "记忆碎片 (2000)",
        "177.绿里奇迹.rmvb": "绿里奇迹 (1999)",
        "185.荒岛故事.mp4": "荒岛故事 (2011)",
        "174.纵横四海.1991.国粤双语可切换音轨.mkv": "纵横四海 (1991)",
        "161.惊魂记.mkv": "惊魂记 (1960)",
        "162.黑客帝国3-矩阵革命.国语（2003）.mkv": "黑客帝国3：矩阵革命 (2003)",
        "173.风之谷.mkv": "风之谷 (1984)",
        "182.忠犬八公物语.1987.mp4": "忠犬八公物语 (1987)",
        "180.岁月神偷.国粤双语可切换音轨.mkv": "岁月神偷 (2010)",
        "187.小偷家族.mp4": "小偷家族 (2018)",
        "183.雨中曲.1952.mkv": "雨中曲 (1952)",
        "179.疯狂的石头.rmvb": "疯狂的石头 (2006)",
        "164.电锯惊魂.mkv": "电锯惊魂 (2004)",
        "171.英雄本色.1986.国粤双语可切换音轨.mkv": "英雄本色 (1986)",
        "169.谍影重重3.2007.4K.mp4": "谍影重重3 (2007)",
        "167.疯狂原始人.mp4": "疯狂原始人 (2013)",
        "188.无间道2国粤双语可切换音轨.mkv": "无间道2 (2003)",
        "160.头脑特工队.mp4": "头脑特工队 (2015)",
        "168.心迷宫.mkv": "心迷宫 (2014)",
        "181.小丑.2019.4K.mp4": "小丑 (2019)",
        "170.上帝之城.mp4": "上帝之城 (2002)",
        "166.达拉斯买家俱乐部 BD720P.mkv": "达拉斯买家俱乐部 (2013)",
        "189.心灵奇旅.mp4": "心灵奇旅 (2020)",
        "165.三块广告牌.mp4": "三块广告牌 (2017)",
        "186.2001太空漫游.mp4": "2001太空漫游 (1968)",
        "184.背靠背，脸对脸.mkv": "背靠背，脸对脸 (1994)",
        "176.爱在午夜降临前.mkv": "爱在午夜降临前 (2013)",
        "172.卢旺达饭店.mp4": "卢旺达饭店 (2004)",
        "159.七武士.mp4": "七武士 (1954)",
        "163.你的名字.mp4": "你的名字。 (2016)",
        "151.九品芝麻官.mkv": "九品芝麻官 (1994)",
        "150.喜宴.1993.mkv": "喜宴 (1993)",
        "144.告白.mp4": "告白 (2010)",
        "156.花样年华.国粤双语可切换音轨.mkv": "花样年华 (2000)",
        "157.血战钢锯岭.mkv": "血战钢锯岭 (2016)",
        "143.玛丽和马克思.mkv": "玛丽和马克思 (2009)",
        "152.模仿游戏.mp4": "模仿游戏 (2014)",
        "149.头号玩家.4K.mp4": "头号玩家 (2018)",
        "158.恐怖直播.mkv": "恐怖直播 (2013)",
        "147.茶馆.mkv": "茶馆 (1982)",
        "154.我是山姆.mp4": "我是山姆 (2001)",
        "142.被解救的姜戈.mkv": "被解救的姜戈 (2012)",
        "153.阳光姐妹淘.2021.4K.mkv": "阳光姐妹淘 (2021)",
        "148.射雕英雄传之东成西就.国语.mkv": "射雕英雄传之东成西就 (1993)",
        "141.神偷奶爸（卑鄙的我）.2010.4K.mp4": "神偷奶爸 (2010)",
        "138.玩具总动员3.2010.4K.mp4": "玩具总动员3 (2010)",
        "135.怪兽电力公司.mp4": "怪兽电力公司 (2001)",
        "126.时空恋旅人【2013】.mkv": "时空恋旅人 (2013)",
        "139.新世界.2013.韩语中字.mp4": "新世界 (2013)",
        "131.一个叫欧维的男人决定去Si.mp4": "一个叫欧维的男人决定去死 (2015)",
        "134.哈利波特与火焰杯.mp4": "哈利·波特与火焰杯 (2005)",
        "125.寄生虫.mp4": "寄生虫 (2019)",
        "136.萤火之森.mkv": "萤火之森 (2011)",
        "128.小森林-冬春篇.mp4": "小森林 冬春篇 (2015)",
        "123.无人知晓.mp4": "无人知晓 (2004)",
        "137.傲慢与偏见.2005.mkv": "傲慢与偏见 (2005)",
        "130.驯龙高手.2010.mkv": "驯龙高手 (2010)",
        "129.幸福终点站.rmvb": "幸福终点站 (2004)",
        "124.倩女幽魂1987.国粤双语可切换音轨.mkv": "倩女幽魂 (1987)",
        "133.教父3.1990.4K.mp4": "教父3 (1990)",
        "116.甜蜜蜜.mkv": "甜蜜蜜 (1996)",
        "112.幽灵公主.1997.rmvb": "幽灵公主 (1997)",
        "105.剪刀手爱德华【1990】.mkv": "剪刀手爱德华 (1990)",
        "113.超能陆战队.4K.mp4": "超能陆战队 (2014)",
        "117.借东西的小人阿莉埃蒂.mp4": "借东西的小人阿莉埃蒂 (2010)",
        "120.消失的爱人.2014.4K.mp4": "消失的爱人 (2014)",
        "109.勇敢的心.mkv": "勇敢的心 (1995)",
        "122.完美的世界.rmvb": "完美的世界 (1993)",
        "114.爱在日落黄昏时.mkv": "爱在日落黄昏时 (2004)",
        "118.天使爱美丽【2001】.mkv": "天使爱美丽 (2001)",
        "104.断背山.mp4": "断背山 (2005)",
        "107.入殓师.rmvb": "入殓师 (2008)",
        "106.爱在黎明破晓前.rmvb": "爱在黎明破晓前 (1995)",
        "111.重庆森林.mp4": "重庆森林 (1994)",
        "108.蝙蝠侠黑暗骑士崛起.4K.mp4": "蝙蝠侠：黑暗骑士崛起 (2012)",
        "091.喜剧之王.mkv": "喜剧之王 (1999)",
        "098.一一.mp4": "一一 (2000)",
        "101.7号房的礼物.韩国.2013.mkv": "7号房的礼物 (2013)",
        "100.唐伯虎点秋香.1993.国语版.mkv": "唐伯虎点秋香 (1993)",
        "089.摩登时代.1936.mkv": "摩登时代 (1936)",
        "094.七宗罪.mp4": "七宗罪 (1995)",
        "095.红辣椒.rmvb": "红辣椒 (2006)",
        "099.狩猎.2012.mkv": "狩猎 (2012)",
        "096.加勒比海盗.2003.mp4": "加勒比海盗 (2003)",
        "102.被嫌弃的松子的一生.mp4": "被嫌弃的松子的一生 (2006)",
        "022.教父1.1972.4K.mp4": "教父 (1972)",
        "087.超脱.2011.mp4": "超脱 (2011)",
        "097.哈利波特与密室.mp4": "哈利·波特与密室 (2002)",
        "092.致命ID.2003.4K.mp4": "致命ID (2003)",
        "006.千与千寻.mkv": "千与千寻 (2001)",
        "076.小鞋子.mp4": "小鞋子 (1997)",
        "082.致命魔术.mp4": "致命魔术 (2006)",
        "078.布达佩斯大饭店.mp4": "布达佩斯大饭店 (2014)",
        "085.海豚湾【2009】.mkv": "海豚湾 (2009)",
        "074.哈利波特与死亡圣器(下).mp4": "哈利·波特与死亡圣器(下) (2011)",
        "084.哈利波特与阿兹卡班的囚徒.mp4": "哈利·波特与阿兹卡班的囚徒 (2004)",
        "083.心灵捕手[1997].rmvb": "心灵捕手 (1997)",
        "081.功夫.2008.4K.mp4": "功夫 (2004)",
        "075.飞越疯人院.mp4": "飞越疯人院 (1975)",
        "079.禁闭岛.mp4": "禁闭岛 (2010)",
        "086.低俗小说.1994.4K.mp4": "低俗小说 (1994)",
        "080.蝴蝶效应.mp4": "蝴蝶效应 (2004)",
        "058.教父2.1974.4K.mp4": "教父2 (1974)",
        "077.沉默的羔羊.mkv": "沉默的羔羊 (1991)",
        "059.狮子王.1994.mkv": "狮子王 (1994)",
        "065.穿条纹睡衣的男孩.mp4": "穿条纹睡衣的男孩 (2008)",
        "073.拯救大兵瑞恩.4K.mp4": "拯救大兵瑞恩 (1998)",
        "062.搏击俱乐部.mp4": "搏击俱乐部 (1999)",
        "070.看不见的客人.mp4": "看不见的客人 (2016)",
        "067.情书.mp4": "情书 (1995)",
        "063.美丽心灵.rmvb": "美丽心灵 (2001)",
        "072.阿凡达.mp4": "阿凡达 (2009)",
        "060.辩护人.mkv": "辩护人 (2013)",
        "071.音乐之声.mp4": "音乐之声 (1965)",
        "066.窃听风暴.2006.mkv": "窃听风暴 (2006)",
        "061.饮食男女.mkv": "饮食男女 (1994)",
        "057.指环王1护戒使者.mp4": "指环王1：护戒使者 (2001)",
        "069.西西里的美丽传说.mp4": "西西里的美丽传说 (2000)",
        "068.两杆大烟枪.mkv": "两杆大烟枪 (1998)",
        "064.本杰明·巴顿奇事[2008].rmvb": "本杰明·巴顿奇事 (2008)",
        "054.绿皮书.mp4": "绿皮书 (2018)",
        "053.死亡诗社.mp4": "死亡诗社 (1989)",
        "041.让子弹飞.2010.4K.mp4": "让子弹飞 (2010)",
        "046.海蒂和爷爷.mp4": "海蒂和爷爷 (2015)",
        "043.鬼子来了.mp4": "鬼子来了 (2000)",
        "044.猫鼠游戏.mp4": "猫鼠游戏 (2002)",
        "048.大话西游之月光宝盒.国粤双语可切换音轨.mkv": "大话西游之月光宝盒 (1995)",
        "055.大闹天宫.mkv": "大闹天宫 (1961)",
        "047.钢琴家.mkv": "钢琴家 (2002)",
        "045.少年派的奇幻漂流.4K.mkv": "少年派的奇幻漂流 (2012)",
        "051.罗马假日.mkv": "罗马假日 (1953)",
        "056.黑客帝国.mp4": "黑客帝国 (1999)",
        "050.闻香识女人.mp4": "闻香识女人 (1992)",
        "042.天空之城.mp4": "天空之城 (1986)",
        "049.指环王2双塔奇兵.mp4": "指环王2：双塔奇兵 (2002)",
        "006.千与千寻（2）.mkv": "千与千寻 (2001)",
        "034.乱世佳人.mkv": "乱世佳人 (1939)",
        "003.阿甘正传.1994.mp4": "阿甘正传 (1994)",
        "007.美丽人生.1997.mp4": "美丽人生 (1997)",
        "040.摔跤吧！爸爸.mp4": "摔跤吧！爸爸 (2016)",
        "035.飞屋环游记.mp4": "飞屋环游记 (2009)",
        "005.这个杀手不太冷.1994.4K.mp4": "这个杀手不太冷 (1994)",
        "004.泰坦尼克号.mp4": "泰坦尼克号 (1997)",
        "039.何以为家.mp4": "何以为家 (2018)",
        "038.十二怒汉.rmvb": "十二怒汉 (1957)",
        "001.肖申克的救赎.1994.4K.mp4": "肖申克的救赎 (1994)",
        "026.末代皇帝.mp4": "末代皇帝 (1987)",
        "037.哈尔的移动城堡.mp4": "哈尔的移动城堡 (2004)",
        "036.素媛.mp4": "素媛 (2013)",
        "032.指环王3王者无敌.mp4": "指环王3：王者无敌 (2003)",
        "023.触不可及.mp4": "触不可及 (2011)",
        "011.楚门的世界.1998.4K.mp4": "楚门的世界 (1998)",
        "016.机器人总动员.rmvb": "机器人总动员 (2008)",
        "017.无间道1国粤双语可切换音轨.mkv": "无间道 (2002)",
        "021.熔炉.Silenced.2011.mp4": "熔炉 (2011)",
        "008.辛德勒的名单.1993.4K.mp4": "辛德勒的名单 (1993)",
        "014.三傻大闹宝莱坞.印国粤三语可切换音轨.mkv": "三傻大闹宝莱坞 (2009)",
        "017.无间道3国粤双语可切换音轨.mkv": "无间道3：终极无间 (2003)",
        "015.放牛班的春天.mp4": "放牛班的春天 (2004)",
        "020.大话西游之大圣娶亲.国粤双语可切换音轨.mkv": "大话西游之大圣娶亲 (1995)",
        "002.霸王别姬.国语.1993.mp4": "霸王别姬 (1993)",
        "012.忠犬八公的故事.mkv": "忠犬八公的故事 (2009)",
        "013.海上钢琴师.mp4": "海上钢琴师 (1998)",
        "010.盗梦空间.2010.4K.mp4": "盗梦空间 (2010)",
        "019.控方证人.mp4": "控方证人 (1957)",
        "029.活着.mkv": "活着 (1994)",
        "217.罗生门.1950.mp4": "罗生门 (1950)",
        "238.千年女优 (2001) .mp4": "千年女优 (2001)",
        "093杀人回忆-2003_BD韩语中字.mp4": "杀人回忆 (2003)",
        "132.未麻的部屋 (1997) .mp4": "未麻的部屋 (1997)",
        "90.美国往事.mkv": "美国往事 (1984)",
        "110.灵异第六感.rmvb": "灵异第六感 (1999)",
        "030.蝙蝠侠-黑暗骑士.4K.mp4": "蝙蝠侠：黑暗骑士 (2008)",
        "031.哈利波特与魔法石.mp4": "哈利·波特与魔法石 (2001)",
        "028.寻梦环游记.中英双语可切换音轨.mp4": "寻梦环游记 (2017)",
        "027.怦然心动.中英双语可切换音轨.mp4": "怦然心动 (2010)",
        "249.香水.mp4": "香水 (2006)",
        "024.当幸福来敲门.mp4": "当幸福来敲门 (2006)",
        "231.血钻 (2006) 国粤双语可切换音轨.mkv": "血钻 (2006)",
        "247.蜘蛛侠-平行宇宙.2018.4K.mp4": "蜘蛛侠：平行宇宙 (2018)",
        "248.再次出发之纽约遇见你.2013.mp4": "再次出发之纽约遇见你 (2013)",
        "240.弱点.rmvb": "弱点 (2009)",
        "225.奇迹男孩 Wonder (2017) .mp4": "奇迹男孩 (2017)",
        "146.大鱼.2003.mp4": "大鱼 (2003)",
        "241.白日梦想家.rmvb": "白日梦想家 (2013)",
        "201.你看起来好像很好吃.mkv": "你看起来好像很好吃 (2010)",
        "243.哈利波特与凤凰社.mp4": "哈利·波特与凤凰社 (2007)",
        "246.朗读者.mp4": "朗读者 (2008)",
        "242.阿飞正传.mp4": "阿飞正传 (1990)",
        "230.芙蓉镇.1986.mp4": "芙蓉镇 (1986)",
        "250 廊桥Y梦.mp4": "廊桥遗梦 (1995)",
        "245.燃情岁月.rmvb": "燃情岁月 (1994)",
        "244.谍影重重1.2002.4K.mp4": "谍影重重 (2002)",
        "227.二十二.mp4": "二十二 (2017)",
        "224.彗星来的那一夜.rmvb": "彗星来的那一夜 (2013)",
        "223.无耻混蛋.rmvb": "无耻混蛋 (2009)",
        "233.房间.mp4": "房间 (2015)",
        "228.爱乐之城.2016.4K.mp4": "爱乐之城 (2016)",
        "145.哪吒闹海.1979.mkv": "哪吒闹海 (1979)",
        "232.战争之王.mp4": "战争之王 (2005)",
        "239.谍影重重2.2004.4K.mp4": "谍影重重2 (2004)",
        "236.哈利波特与死亡圣器(上).mp4": "哈利·波特与死亡圣器(上) (2010)",
        "229.黑客帝国2 -重装上阵.国语（2003）.mkv": "黑客帝国2：重装上阵 (2003)",
        "237.火星救援.mp4": "火星救援 (2015)",
        "222.崖上的波妞.rmvb": "崖上的波妞 (2008)",
        "235.魂断蓝桥.1940（2）.rmvb": "魂断蓝桥 (1940)",
        "226.花束般的恋爱.mp4": "花束般的恋爱 (2021)",
        "235.魂断蓝桥.1940（1）.rmvb": "魂断蓝桥 (1940)",
        "206.源代码.mkv": "源代码 (2011)",
        "209.恋恋笔记本[2004].mp4": "恋恋笔记本 (2004)",
        "009.星际穿越.4K.mp4": "星际穿越 (2014)",
        "216.疯狂的麦克斯4-狂暴之路.mp4": "疯狂的麦克斯4：狂暴之路 (2015)",
        "213.青蛇.1993.国粤双语可切换音轨.mkv": "青蛇 (1993)",
        "210.初恋这件小事.avi": "初恋这件小事 (2010)",
        "211.波西米亚狂想曲.mp4": "波西米亚狂想曲 (2018)",
        "219.萤火虫之墓.mkv": "萤火虫之墓 (1988)",
        "218.新龙门客栈.国语.mkv": "新龙门客栈 (1992)",
        "207.雨人.mkv": "雨人 (1988)",
        "214.虎口脱险.mkv": "虎口脱险 (1966)",
        "215.终结者2-审判日 [1991].mp4": "终结者2：审判日 (1991)",
        "018.疯狂动物城.mp4": "疯狂动物城 (2016)",
        "221.千钧一发.mp4": "千钧一发 (1997)",
        "208.海边的曼彻斯特.mp4": "海边的曼彻斯特 (2016)",
        "220.末路狂花.rmvb": "末路狂花 (1991)",
        "212.人工智能.mp4": "人工智能 (2001)"
    };

    // Pinyin to Chinese character mapping for common movie/show titles
    // Expanded for better coverage
    const PINYIN_HINTS = {
        // Actors / Directors
        'xiaozhan': '肖战', 'wangyibo': '王一博', 'yangmi': '杨幂',
        'zhaoliying': '赵丽颖', 'dilireba': '迪丽热巴',
        'huangbo': '黄渤', 'wujing': '吴京', 'chenglong': '成龙',
        'zhourunfa': '周润发', 'liudewei': '刘德华', 'liangchaowei': '梁朝伟',
        'zhangyimou': '张艺谋', 'fengxiaogang': '冯小刚',
        'jiangwen': '姜文', 'xuzheng': '徐峥', 'huangxiaoming': '黄晓明',
        'dengchao': '邓超', 'chenkun': '陈坤', 'guofucheng': '郭富城',
        'gongli': '巩俐', 'zhangziyi': '章子怡', 'zhoudongyu': '周冬雨',
        // Cities / Places
        'chengdu': '成都', 'beijing': '北京', 'shanghai': '上海',
        'xianggang': '香港', 'hongkong': '香港', 'taiwan': '台湾',
        'dongjing': '东京', 'shouer': '首尔',
        // Common movie-related terms
        'dianying': '电影', 'diandian': '点点',
        'wanmei': '完美', 'chuangyue': '创越',
        'yingxiong': '英雄', 'gongfu': '功夫',
        'wuxia': '武侠', 'xianxia': '仙侠',
        'donghua': '动画', 'jilupian': '纪录片',
        'juji': '剧集', 'dianshiju': '电视剧',
        'meiju': '美剧', 'hanju': '韩剧', 'riju': '日剧',
        'taiju': '台剧', 'gangju': '港剧',
        'daye': '大爷', 'shaolin': '少林',
        'huangfei': '黄飞', 'huangfeihong': '黄飞鸿',
        'yewen': '叶问', 'huojuan': '霍元甲',
        'huoyuanjia': '霍元甲',
        'xijuyou': '喜剧人', 'xiyou': '西游',
        'xiyouji': '西游记', 'sanguo': '三国',
        'shuihu': '水浒', 'honglou': '红楼',
        'hongloumeng': '红楼梦',
        'fengshen': '封神', 'liaozhai': '聊斋',
        'zhenhuan': '甄嬛', 'langyabang': '琅琊榜',
        'qingyunian': '庆余年', 'chenqingling': '陈情令',
        'huapiandui': '王牌部队',
        'manyou': '漫游', 'xingji': '星际',
        'daomengkong': '盗梦空间',
        'xingjikong': '星际穿越',
        'dianyingban': '电影版',
        'juchangban': '剧场版',
        // Common pinyin fragments in filenames
        'lu': '鹿', 'yuan': '原', 'bailu': '白鹿', 'bailuyuan': '白鹿原',
        'chuang': '闯', 'guandong': '关东', 'chuangguandong': '闯关东',
        'hong': '红', 'lou': '楼', 'meng': '梦',
        'shuifu': '水浒', 'shuihuzhuan': '水浒传',
        'xi': '西', 'you': '游', 'ji': '记',
        'san': '三', 'guo': '国', 'yanyi': '演义',
        'jia': '家', 'chunqiu': '春秋',
        'zhen': '甄', 'huan': '嬛', 'lang': '琅', 'ya': '琊', 'bang': '榜',
        'qing': '庆', 'yu': '余', 'nian': '年',
        'daming': '大明', 'gongci': '宫词',
        'fumu': '父母', 'aiqing': '爱情',
        'zhi': '之', 'fou': '否', 'ying': '应', 'shi': '是', 'lvv': '绿', 'fei': '肥', 'hongshou': '红瘦',
        'ren': '人', 'de': '的', 'mingyi': '名义', 'renmindemingyi': '人民的名义',
        'dou': '都', 'ting': '挺', 'hao': '好',
        'lao': '老', 'nongmin': '农民',
        'zhong': '中', 'guo': '国', 'shixiang': '式乡', 'cun': '村', 'ai': '爱', 'qingshi': '情事',
        'fan': '繁', 'hua': '花',
        'kuang': '狂', 'biao': '飙',
        'man': '漫', 'ji': '集的', 'jijie': '季节',
        'er': '儿', 'nv': '女',
        'zhang': '长', 'xiangsi': '相思',
    };

    function cleanTitle(raw) {
        if (!raw) return '';
        let title = raw.trim();

        // Quick reject: bare quality-only filenames (very short + contains quality keyword)
        if (title.length < 12 && FILE_QUALITY_KEYWORDS.test(title)) return '';

        // Remove file extension
        title = title.replace(/\.(mp4|mkv|avi|wmv|flv|rmvb|mov|ts|m4v|webm|mpg|mpeg|vob)$/i, '');

        // ===== Token-based cleaning =====
        // Split by common separators (dots, underscores, hyphens, middle dots, ampersands)
        const parts = title.split(/[._\-—·&｜|]+/).filter(p => p.length > 0);

        const cleaned = [];
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const pLower = part.toLowerCase();

            // Extract year suffix from tokens like "白鹿原2017"
            let current = part;
            let yearPart = null;
            const yearMatch = current.match(/^(.*?)((?:19|20)\d{2})$/);
            if (yearMatch) {
                current = yearMatch[1].trim();
                yearPart = yearMatch[2];
            }

            // Skip pure year tokens
            if (/^(?:19|20)\d{2}$/.test(current)) {
                if (yearPart) cleaned.push(yearPart); // keep the year
                continue;
            }

            // Skip pure resolution/quality tokens
            if (/^(?:4k|8k|1080p?|720p?|2160p?|480p|hdr|sdr|dolby[\s._-]*vision|imax)$/i.test(current)) continue;

            // Skip source/format tokens
            if (/^(?:bluray|bdrip|web[\s._-]?dl|hdtv|dvdrip|remux|brrip|hdrip|hd|fhd|uhd)$/i.test(current)) continue;

            // Skip episode/season tokens (including compound like "《父母爱情》第01集")
            if (/^(?:\d+集全?|完结|全\d+集|\d+部|season\s*\d+|s\d+e?\d*|ep?\d+|.*第\d+[集话部])$/i.test(current)) continue;

            // Skip leading sequence numbers (001, 002, etc.)
            if (i === 0 && /^\d{1,4}$/.test(current)) continue;

            // Skip long numeric tokens (>4 digits: file IDs, hashes)
            if (/^\d{5,}$/.test(current)) continue;

            // Skip standalone small numbers (artifact from & splitting)
            if (/^\d{1,3}$/.test(current) && i > 0) continue;

            // Skip media/format descriptors in filenames
            if (/^(?:drama|movie|film|video|music|3gp|webm|hevc|avc|h264|h265|x264|x265)$/i.test(current)) continue;

            // Skip audio/subtitle tokens (expanded)
            if (/^(?:国语|粤语|日语|韩语|英语|中字|字幕|双语|原声|chs|eng|cht|aac|dts|flac|truehd|atmos|国粤双语|国粤日|中文字幕|内嵌字幕|繁中|简中|繁体|简体|普通话|台配|港配|国语中字|日语中字|韩语中字|英语中字|粤语中字|中日双语|中英双语|国英双语|中日字幕|中英字幕)$/i.test(current)) continue;

            // Also skip compound audio/subtitle tokens (e.g. "国粤日三语", "中英日字幕")
            if (/^(?:国语|粤语|日语|韩语|英语|中字|字幕|双语|三语|四语|原声|繁中|简中|繁体|简体|普通话|台配|港配){2,}$/i.test(current)) continue;

            // Skip edition/version tokens
            if (/^(?:导演剪辑版?|加长版?|未删减版?|终极版?|修复版?|重制版?|特别版?|花絮|彩蛋|预告|剧场版|电影版|电视版|网络版|院线版|公映版|蓝光版|高清版?|超清版?)$/i.test(current)) continue;

            // Skip generic descriptive tokens
            if (/^(?:正片|番外|番外篇|前传|后传|续集|外传|彩蛋|片尾|彩蛋后|片尾彩蛋|ost|原声带|主题曲|插曲)$/i.test(current)) continue;

            // Skip bracket-wrapped junk
            if (/^[\(（\[【〖].*[\)）\]】〗]$/.test(current)) continue;

            // Skip standalone "4K原始" type tokens
            if (/^(?:4[Kk]原始|原始4[Kk]|[Kk]4)$/i.test(current)) continue;

            cleaned.push(current);
            if (yearPart) cleaned.push(yearPart);
        }

        let result = cleaned.join(' ').trim();

        // Remove any remaining bracketed content: (2023), [HDR], （国语）, 《书名》
        result = result.replace(/[\(（\[【〖《〈][^)）\]】〗》〉]*[\)）\]】〗》〉]/g, '').trim();

        // Strip trailing/leading punctuation
        result = result.replace(/^[\s\-_—·.：:，,、]+|[\s\-_—·.：:，,、]+$/g, '').trim();

        // Collapse multiple spaces
        result = result.replace(/\s+/g, ' ').trim();

        return result;
    }

    /**
     * Extract year from a string like "2023" or "(2023)"
     */
    function extractYear(raw) {
        if (!raw) return null;
        const match = raw.match(/[\(（\[]?((?:19|20)\d{2})[\)）\]]?/);
        return match ? match[1] : null;
    }

    /**
     * Detect if a string looks like pinyin (romanized Chinese)
     */
    function looksLikePinyin(str) {
        if (!str) return false;
        // Pure ASCII alphabetic, no spaces (e.g. "xiaozhan", "wangyibo")
        if (/^[a-zA-Z]+$/.test(str) && str.length > 3) return true;
        // CamelCase pinyin (e.g. "XiaoZhan", "WangYiBo")
        if (/^[A-Z][a-z]+(?:[A-Z][a-z]+)+$/.test(str)) return true;
        return false;
    }

    /**
     * Try to convert pinyin to Chinese characters
     */
    function pinyinToChinese(pinyin) {
        const lower = pinyin.toLowerCase();
        for (const [key, value] of Object.entries(PINYIN_HINTS)) {
            if (lower.includes(key)) return value;
        }
        return null;
    }

    /**
     * Generate multiple search query variants for better matching
     */
    function generateSearchQueries(title, file) {
        const queries = new Set();
        const year = extractYear(file.folderPath || file.name || file.title || '');

        // Original cleaned title
        if (title) queries.add(title);

        // With year suffix for precision
        if (title && year) queries.add(`${title} ${year}`);

        // If title contains Chinese + non-Chinese, try just the Chinese part
        const chinesePart = title.match(/[\u4e00-\u9fff]+/g);
        if (chinesePart && chinesePart.length > 0) {
            queries.add(chinesePart.join(''));
        }

        // If title contains English words, try just the English part
        const englishPart = title.match(/[a-zA-Z][a-zA-Z\s]*/g);
        if (englishPart && englishPart.length > 0) {
            const eng = englishPart.join(' ').trim();
            if (eng.length > 2) queries.add(eng);
        }

        // If it looks like pinyin, try to convert
        if (looksLikePinyin(title.replace(/\s/g, ''))) {
            const chinese = pinyinToChinese(title);
            if (chinese) queries.add(chinese);
        }

        // Mixed Chinese + pinyin: replace pinyin fragments (e.g. "白lu原" → "白鹿原")
        const mixedPinyin = title.match(/[a-zA-Z]{2,}/g);
        if (mixedPinyin) {
            let converted = title;
            let hasConverted = false;
            for (const pinyinFrag of mixedPinyin) {
                const chinese = pinyinToChinese(pinyinFrag);
                if (chinese) {
                    converted = converted.replace(pinyinFrag, chinese);
                    hasConverted = true;
                }
            }
            if (hasConverted && converted !== title) {
                queries.add(converted);
            }
        }

        // If title has separators like "：" or "-", split and try each part
        const parts = title.split(/[：:\-–—]/);
        if (parts.length > 1) {
            for (const part of parts) {
                const cleaned = cleanTitle(part);
                if (cleaned && cleaned.length > 1) queries.add(cleaned);
            }
        }

        // Try the file name as a fallback
        const rawFileName = file.name || file.title || '';
        const fileName = rawFileName.replace(/\.[^.]+$/, '');
        const cleanedFileName = cleanTitle(fileName);
        if (cleanedFileName && cleanedFileName !== title) {
            queries.add(cleanedFileName);
        }

        return [...queries];
    }

    function getTitleFromFile(file) {
        // Handle both raw file objects (from share parser) and movie objects (from import)
        const rawName = file.name || file.title || '';
        if (!rawName) return '';

        // Strategy 1: Try filename first (usually contains the actual movie/show title)
        const fileName = rawName.replace(/\.[^.]+$/, '');
        const titleFromName = cleanTitle(fileName);

        // Strategy 2: Try folder path (skip generic folders)
        const folderPath = file.folderPath || '';
        const parts = folderPath.split(/\s*\/\s*/);
        let titleFromFolder = '';

        for (let i = parts.length - 1; i >= 0; i--) {
            const part = parts[i];
            if (SKIP_FOLDERS.has(part) || /^(share[-_]?)?root$/i.test(part)) continue;
            const cleaned = cleanTitle(part);
            if (cleaned && cleaned.length >= 2) {
                titleFromFolder = cleaned;
                break;
            }
        }

        // Prefer filename title if it looks good (>= 2 chars and contains Chinese or is clearly a title)
        if (titleFromName && titleFromName.length >= 2) {
            // If filename title contains Chinese characters, it's almost certainly correct
            if (/[\u4e00-\u9fff]/.test(titleFromName)) return titleFromName;
            // If it's a multi-word English title, also prefer it
            if (titleFromName.length >= 4) return titleFromName;
        }

        // Use folder title as fallback
        if (titleFromFolder) return titleFromFolder;

        // Last resort: raw title from filename
        return titleFromName || fileName;
    }

    function detectMediaType(file) {
        const path = (file.folderPath || '').toLowerCase();
        // 电视剧/综艺/剧集 → 一律 TV
        if (path.includes('电视剧') || path.includes('综艺') || path.includes('剧集')) return 'tv';
        // 电影/豆瓣/剧场版 → 一律 movie
        if (path.includes('电影') || path.includes('豆瓣') || path.includes('剧场版')) return 'movie';
        // 动漫/动画 → 不强制，返回 null 让后续根据文件特征自主判断（单文件可能是电影，多文件可能是剧集）
        if (path.includes('动漫') || path.includes('动画')) return null;
        if (path.includes('纪录片') || path.includes('纪录')) return 'movie';

        const name = (file.name || file.title || '').toLowerCase();
        if (/s\d+e\d+|第\d+集|第\d+话|ep\d+/i.test(name)) return 'tv';

        // Check folder name patterns
        const folderName = (file.folderPath || '').split('/').pop() || '';
        if (/第.*季|Season/i.test(folderName)) return 'tv';

        return null;
    }

    // ===== TMDB API =====

    async function tmdbFetch(path, params = {}) {
        // Ensure /3/ version prefix for TMDB API v3
        if (!path.startsWith('/3/')) path = '/3' + path;
        const query = new URLSearchParams(params).toString();
        const url = '/api/tmdb' + path + (query ? '?' + query : '');
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`TMDB API error: ${resp.status}`);
        return resp.json();
    }

    async function searchTMDB(query, mediaType) {
        const params = { query: query, language: 'zh-CN' };

        // TMDB /search/multi doesn't support a 'type' param.
        // Use type-specific endpoint when specified, multi-search as fallback.
        let data;
        if (mediaType === 'movie') {
            data = await tmdbFetch('/search/movie', params);
            if (data.results && data.results.length > 0) {
                data.results = data.results.map(r => ({ ...r, media_type: 'movie' }));
            }
        } else if (mediaType === 'tv') {
            data = await tmdbFetch('/search/tv', params);
            if (data.results && data.results.length > 0) {
                data.results = data.results.map(r => ({ ...r, media_type: 'tv' }));
            }
        } else {
            data = await tmdbFetch('/search/multi', params);
        }

        if (!data || !data.results || data.results.length === 0) return null;

        let results = data.results;
        if (mediaType) {
            const filtered = results.filter(r => r.media_type === mediaType);
            if (filtered.length > 0) results = filtered;
        }

        // 按标题匹配度排序（精确匹配 > 包含匹配 > 部分匹配 > 热度）
        const queryLower = query.toLowerCase();
        results.sort((a, b) => {
            const aTitle = (a.title || a.name || '').toLowerCase();
            const bTitle = (b.title || b.name || '').toLowerCase();
            const aExact = aTitle === queryLower ? 3 : aTitle.includes(queryLower) ? 2 : 0;
            const bExact = bTitle === queryLower ? 3 : bTitle.includes(queryLower) ? 2 : 0;
            if (aExact !== bExact) return bExact - aExact;
            return (b.popularity || 0) - (a.popularity || 0);
        });
        return results[0];
    }

    /**
     * Smart search: try multiple queries with fallbacks
     * Enhanced with lenient fuzzy matching
     */
    async function smartSearch(title, mediaType, file) {
        const queries = generateSearchQueries(title, file);

        for (const query of queries) {
            try {
                const result = await searchTMDB(query, mediaType);
                if (result) {
                    // Verify the result makes sense
                    const resultTitle = (result.title || result.name || '').toLowerCase();
                    const resultOriginal = (result.original_title || result.original_name || '').toLowerCase();
                    const queryLower = query.toLowerCase();

                    // Check if result title contains the query (or vice versa)
                    const directMatch = resultTitle.includes(queryLower) || resultOriginal.includes(queryLower)
                        || queryLower.includes(resultTitle);

                    // Chinese character overlap (must be significant)
                    const queryChinese = queryLower.match(/[\u4e00-\u9fff]/g);
                    const resultChinese = (resultTitle + resultOriginal).match(/[\u4e00-\u9fff]/g);
                    const chineseOverlap = queryChinese && resultChinese
                        ? queryChinese.filter(c => resultChinese.includes(c)).length
                        : 0;
                    const chineseRatio = queryChinese ? chineseOverlap / queryChinese.length : 0;

                    // Strict match: direct string match OR >=50% Chinese overlap
                    if (directMatch || chineseRatio >= 0.5) {
                        return result;
                    }

                    // Year match as supplementary evidence
                    if (chineseRatio >= 0.3 && file) {
                        const fileYear = extractYear(file.folderPath || file.name || file.title || '');
                        const resultYear = (result.release_date || result.first_air_date || '').split('-')[0];
                        if (fileYear && resultYear === fileYear) return result;
                    }
                }
            } catch (e) {
                // Try next query
                continue;
            }
        }

        // 所有查询均未通过验证 → 返回 null，不随机接受第一个结果
        console.warn('[TMDB] 所有查询未通过验证: ' + queries.join(' | ') + ' → 放弃，标记为需人工处理');
        return null;
    }

    async function getDetails(tmdbId, mediaType) {
        const endpoint = mediaType === 'tv' ? '/tv' : '/movie';
        const data = await tmdbFetch(`${endpoint}/${tmdbId}`, {
            language: 'zh-CN',
            append_to_response: 'credits,images',
        });
        return data;
    }

    /**
     * Fetch season episodes from TMDB for a TV show.
     * @returns Map of episode_number → { name, overview, stillPath, episodeNumber }
     */
    let _episodeCache = {};
    async function fetchSeasonEpisodes(tvId, seasonNum) {
        const cacheKey = `${tvId}_s${seasonNum}`;
        if (_episodeCache[cacheKey]) return _episodeCache[cacheKey];

        try {
            const data = await tmdbFetch(`/tv/${tvId}/season/${seasonNum}`, { language: 'zh-CN' });
            const eps = {};
            for (const ep of (data.episodes || [])) {
                eps[ep.episode_number] = {
                    name: ep.name || '',
                    overview: ep.overview || '',
                    stillPath: ep.still_path ? `${TMDB_IMAGE_BASE}/w300${ep.still_path}` : null,
                    episodeNumber: ep.episode_number,
                };
            }
            _episodeCache[cacheKey] = eps;
            return eps;
        } catch (e) {
            console.warn('Failed to fetch season episodes:', e.message);
            return null;
        }
    }

    /**
     * Try to extract episode number from a file name.
     * e.g., "01.mp4" → 1, "第3集.mp4" → 3, "E05.mkv" → 5
     */
    function extractEpisodeNumber(fileName) {
        const name = fileName || '';
        let match = name.match(/^0*(\d+)\D/);     // "01.mp4"
        if (match) return parseInt(match[1]);
        match = name.match(/第\s*(\d+)\s*[集话]/);  // "第3集"
        if (match) return parseInt(match[1]);
        match = name.match(/[Ee](\d+)/);          // "E05"
        if (match) return parseInt(match[1]);
        match = name.match(/(\d+)/);              // any number
        if (match) return parseInt(match[1]);
        return null;
    }

    /**
     * Clear episode cache (e.g., when TMDB key changes)
     */
    function clearEpisodeCache() {
        _episodeCache = {};
    }

    /**
     * Smart title resolution: take a rough/approximate name and return the best clean title
     * Handles pinyin, fuzzy names, mixed Chinese/English, etc.
     * @param {string} roughName - The rough input name (filename, folder name, user input)
     * @param {object} file - Optional file object for additional context
     * @returns {string} Best guess clean title
     */
    function resolveTitle(roughName, file) {
        if (!roughName) return '';

        // If this is a file object, use the full extraction pipeline
        if (file) {
            return getTitleFromFile(file);
        }

        // Otherwise, just clean the raw string
        return cleanTitle(roughName);
    }

    /**
     * Search TMDB and return multiple results for user selection
     * Used for manual correction when auto-scrape fails
     * @param {string} query - Search query
     * @param {string} mediaType - 'movie' or 'tv' or null
     * @returns {Array} Array of search results with basic info
     */
    async function searchSuggestions(query, mediaType) {
        if (!query || query.trim().length < 2) return [];

        const results = [];
        const seen = new Set();

        // Pick the right search endpoint based on type
        function pickEndpoint(url, params, mediaType) {
            if (mediaType === 'movie') return tmdbFetch('/search/movie', params);
            if (mediaType === 'tv') return tmdbFetch('/search/tv', params);
            return tmdbFetch(url, params);
        }

        // Strategy 1: Direct search
        try {
            const params = { query: query.trim(), language: 'zh-CN' };
            const data = await pickEndpoint('/search/multi', params, mediaType);
            if (data.results) {
                for (const r of data.results.slice(0, 10)) {
                    if (seen.has(r.id)) continue;
                    seen.add(r.id);
                    results.push({
                        tmdbId: r.id,
                        mediaType: r.media_type || mediaType || 'movie',
                        title: r.title || r.name || '',
                        originalTitle: r.original_title || r.original_name || '',
                        year: (r.release_date || r.first_air_date || '').split('-')[0] || '',
                        poster: r.poster_path ? `${TMDB_IMAGE_BASE}/${POSTER_SIZE}${r.poster_path}` : null,
                        overview: (r.overview || '').substring(0, 120) + (r.overview && r.overview.length > 120 ? '...' : ''),
                        popularity: r.popularity || 0,
                    });
                }
            }
        } catch (e) { /* ignore */ }

        // Strategy 2: If query has Chinese, also search in English context
        const hasChinese = /[\u4e00-\u9fff]/.test(query);
        if (hasChinese && results.length < 5) {
            try {
                const chinesePart = query.match(/[\u4e00-\u9fff]+/g);
                if (chinesePart) {
                    const data2 = await tmdbFetch('/search/multi', {
                        query: chinesePart.join(''),
                        language: 'zh-CN',
                    });
                    if (data2.results) {
                        for (const r of data2.results.slice(0, 5)) {
                            if (seen.has(r.id)) continue;
                            seen.add(r.id);
                            results.push({
                                tmdbId: r.id,
                                mediaType: r.media_type || 'movie',
                                title: r.title || r.name || '',
                                originalTitle: r.original_title || r.original_name || '',
                                year: (r.release_date || r.first_air_date || '').split('-')[0] || '',
                                poster: r.poster_path ? `${TMDB_IMAGE_BASE}/${POSTER_SIZE}${r.poster_path}` : null,
                                overview: (r.overview || '').substring(0, 120),
                                popularity: r.popularity || 0,
                            });
                        }
                    }
                }
            } catch (e) { /* ignore */ }
        }

        // Strategy 3: Try pinyin conversion if applicable
        if (looksLikePinyin(query.replace(/\s/g, ''))) {
            const chinese = pinyinToChinese(query);
            if (chinese && chinese !== query) {
                try {
                    const data3 = await tmdbFetch('/search/multi', {
                        query: chinese, language: 'zh-CN',
                    });
                    if (data3.results) {
                        for (const r of data3.results.slice(0, 3)) {
                            if (seen.has(r.id)) continue;
                            seen.add(r.id);
                            results.push({
                                tmdbId: r.id,
                                mediaType: r.media_type || 'movie',
                                title: r.title || r.name || '',
                                originalTitle: r.original_title || r.original_name || '',
                                year: (r.release_date || r.first_air_date || '').split('-')[0] || '',
                                poster: r.poster_path ? `${TMDB_IMAGE_BASE}/${POSTER_SIZE}${r.poster_path}` : null,
                                overview: (r.overview || '').substring(0, 120),
                                popularity: r.popularity || 0,
                            });
                        }
                    }
                } catch (e) { /* ignore */ }
            }
        }

        // Sort by popularity
        results.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
        return results;
    }

    /**
     * Scrape by a specific TMDB ID - used when user manually selects a result
     * @param {number} tmdbId - TMDB ID
     * @param {string} mediaType - 'movie' or 'tv'
     * @returns {object} Metadata object
     */
    async function scrapeByTmdbId(tmdbId, mediaType) {
        const details = await getDetails(tmdbId, mediaType || 'movie');
        return extractMetadata(details, mediaType || 'movie');
    }

    /**
     * Scrape using a custom query string (for manual correction)
     * @param {string} query - User-provided search query
     * @param {string} mediaType - Optional hint
     * @returns {object|null} Metadata or null
     */
    async function scrapeByQuery(query, mediaType) {
        if (!query) return null;
        const cleaned = cleanTitle(query) || query.trim();
        const file = { name: query, folderPath: '' };

        try {
            const result = await smartSearch(cleaned, mediaType, file);
            if (!result) return null;

            const type = result.media_type || mediaType || 'movie';
            const details = await getDetails(result.id, type);
            return extractMetadata(details, type);
        } catch (e) {
            console.warn('scrapeByQuery failed:', e.message);
            return null;
        }
    }

    function extractMetadata(details, mediaType) {
        if (!details) return null;

        const isTv = mediaType === 'tv';
        const genres = (details.genres || []).map(g => g.name);
        const credits = details.credits || {};
        const cast = (credits.cast || []).slice(0, 8).map(c => ({
            name: c.name,
            character: c.character,
            profilePath: c.profile_path ? `${TMDB_IMAGE_BASE}/${PROFILE_SIZE}${c.profile_path}` : null,
        }));
        const crew = credits.crew || [];
        const director = crew.find(c => c.job === 'Director') || crew.find(c => c.job === 'Screenplay');

        return {
            tmdbId: details.id,
            mediaType: mediaType,
            title: details.title || details.name || '',
            originalTitle: details.original_title || details.original_name || '',
            overview: details.overview || '',
            poster: details.poster_path ? `${TMDB_IMAGE_BASE}/${POSTER_SIZE}${details.poster_path}` : null,
            backdrop: details.backdrop_path ? `${TMDB_IMAGE_BASE}/${BACKDROP_SIZE}${details.backdrop_path}` : null,
            rating: details.vote_average ? Math.round(details.vote_average * 10) / 10 : null,
            genres: genres,
            year: (details.release_date || details.first_air_date || '').split('-')[0] || null,
            runtime: isTv
                ? (details.episode_run_time && details.episode_run_time[0]) || null
                : details.runtime || null,
            cast: cast,
            director: director ? director.name : null,
            seasonCount: isTv ? (details.number_of_seasons || null) : null,
            episodeCount: isTv ? (details.number_of_episodes || null) : null,
            status: details.status || null,
            tagline: details.tagline || null,
            // Episode-level data (set by scrapeFile for TV shows)
            episodeName: null,
            episodeOverview: null,
            episodeStill: null,
            episodeNumber: null,
            seasonNumber: null,
        };
    }

    /**
     * Main scrape function with smart multi-strategy search
     */
    async function scrapeFile(file) {
        const title = getTitleFromFile(file);
        if (!title) return null;

        const hintType = detectMediaType(file);

        // Extract season number from folder path
        const folderPath = file.folderPath || '';
        let seasonNum = 1;
        const pathParts = folderPath.split('/');
        for (let i = pathParts.length - 1; i >= 0; i--) {
            const sn = extractSeason(pathParts[i]);
            if (sn !== null) { seasonNum = sn; break; }
        }

        try {
            const searchResult = await smartSearch(title, hintType, file);
            if (!searchResult) return null;

            const mediaType = searchResult.media_type || hintType || 'movie';
            const details = await getDetails(searchResult.id, mediaType);
            const meta = extractMetadata(details, mediaType);

            // For TV shows: fetch season episodes and attach episode-specific data
            if (meta && mediaType === 'tv') {
                const epNum = extractEpisodeNumber(file.name);
                if (epNum) {
                    const eps = await fetchSeasonEpisodes(details.id, seasonNum);
                    if (eps && eps[epNum]) {
                        meta.episodeName = eps[epNum].name || null;
                        meta.episodeOverview = eps[epNum].overview || null;
                        meta.episodeStill = eps[epNum].stillPath || null;
                        meta.episodeNumber = epNum;
                        meta.seasonNumber = seasonNum;
                    } else {
                        meta.episodeNumber = epNum;
                        meta.seasonNumber = seasonNum;
                    }
                }
            }

            return meta;
        } catch (e) {
            console.warn(`Scrape failed for "${title}":`, e.message);
            return null;
        }
    }

    async function scrapeFiles(files, onProgress) {
        const results = [];
        let done = 0;
        const total = files.length;

        for (const file of files) {
            const meta = await scrapeFile(file);
            results.push(meta);
            done++;

            if (onProgress) {
                onProgress({
                    done, total,
                    percent: Math.round(done / total * 100),
                    currentTitle: file.name || file.title || '',
                    found: !!meta,
                });
            }

            if (done < total) {
                await new Promise(r => setTimeout(r, 250));
            }
        }

        return results;
    }

    // ===== Batch Import & Smart Analysis =====

    /**
     * Extract season number from folder name.
     */
    function extractSeason(folderName) {
        if (!folderName) return null;
        const cnMatch = folderName.match(/第\s*([一二三四五六七八九十\d]+)\s*季/);
        if (cnMatch) {
            const d = {一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10};
            const num = cnMatch[1];
            return d[num] || parseInt(num) || null;
        }
        const enMatch = folderName.match(/Season\s*(\d+)/i);
        if (enMatch) return parseInt(enMatch[1]);
        const sMatch = folderName.match(/^S0*(\d+)/i);
        if (sMatch) return parseInt(sMatch[1]);
        return null;
    }

    /**
     * 拼音文件夹名智能识别
     */
    function resolvePinyinFolder(title) {
        if (!title || /[\u4e00-\u9fff]/.test(title)) return null;

        const lower = title.toLowerCase();

        // 策略1: 全词匹配
        if (PINYIN_HINTS[lower]) return PINYIN_HINTS[lower];

        // 策略2: 逐词分割匹配
        const fragments = [];
        let remaining = lower;
        let maxIter = 30;
        while (remaining.length > 0 && maxIter-- > 0) {
            let found = null;
            for (let len = Math.min(remaining.length, 12); len >= 2; len--) {
                const frag = remaining.substring(0, len);
                if (PINYIN_HINTS[frag]) {
                    found = PINYIN_HINTS[frag];
                    fragments.push(found);
                    remaining = remaining.substring(len);
                    break;
                }
            }
            if (!found) break;
        }
        if (fragments.length > 0 && remaining.length < lower.length * 0.5) {
            return fragments.join('');
        }
        return null;
    }

    /**
     * 找公共前缀（剥离首尾数字，如 68.[三国演义] → [三国演义]）
     */
    function findCommonPrefix(names) {
        if (!names.length) return '';
        let prefix = names[0].replace(/\.[^.]+$/, '');   // 去扩展名
        prefix = prefix.replace(/\d+$/, '');              // 去尾部数字
        prefix = prefix.replace(/^\d+[.\-_\s·]*/, '');   // 去开头数字+分隔符（68. → 空）
        if (prefix.length < 2) return '';
        const count = names.filter(n => n.includes(prefix)).length;
        return count / names.length >= 0.6 ? prefix : '';
    }

    /**
     * 从文件名提取集数（考虑不规则前缀命名）
     */
    function extractEpisodeFromFileName(fileName, commonPrefix) {
        let name = fileName.replace(/\.[^.]+$/, '');
        if (commonPrefix && name.startsWith(commonPrefix)) {
            name = name.substring(commonPrefix.length);
        }
        const match = name.match(/0*(\d+)/);
        if (match) return parseInt(match[1]);
        return null;
    }

    /**
     * 为同文件夹文件分配集数
     */
    function assignEpisodes(files) {
        const sorted = [...files].sort((a, b) =>
            (a.name || '').localeCompare(b.name || '', undefined, { numeric: true })
        );
        const prefix = findCommonPrefix(sorted.map(f => f.name || ''));

        return sorted.map((file, idx) => {
            const epNum = extractEpisodeFromFileName(file.name || '', prefix);
            return { file, epNum: epNum || (idx + 1), epNameExpected: null };
        });
    }

    /**
     * 按 folderPath 将文件分组，每组提取刮削线索
     */
    function analyzeImportGroups(files) {
        console.log('[Scrape] v2026-06-23d analyzeImportGroups 开始, 输入 ' + files.length + ' 个文件');
        const folderMap = {};

        // Step 1: 按 folderPath 分组
        for (const f of files) {
            const fp = f.folderPath || '__root__';
            if (!folderMap[fp]) folderMap[fp] = [];
            folderMap[fp].push(f);
        }
        console.log('[Scrape] Step1: ' + Object.keys(folderMap).length + ' 个文件夹路径');

        // Step 2: 合并判断：同上级目录的子文件夹可能属同一部剧
        // 规范化路径（" / " → "/", trim 首尾空格）
        let parentGroups = {};
        for (const [fp, fileList] of Object.entries(folderMap)) {
            const normalizedFp = fp.split(' / ').map(p => p.trim()).join('/').replace(/^\/+|\/+$/g, '') || fp;
            const parts = normalizedFp.split('/');
            const lastName = parts[parts.length - 1];
            const seasonNum = extractSeason(lastName);
            const parent = parts.slice(0, -1).join('/') || '__root__';

            if (seasonNum !== null) {
                if (!parentGroups[parent]) parentGroups[parent] = { files: [], seasons: [] };
                parentGroups[parent].seasons.push({ num: seasonNum, name: lastName, files: fileList });
                parentGroups[parent].files.push(...fileList);
            } else {
                const key = normalizedFp || fp;
                if (!parentGroups[key]) parentGroups[key] = { files: [], seasons: [] };
                parentGroups[key].files.push(...fileList);
                parentGroups[key].isStandalone = true;
            }
        }

        // Step 2.5: 合并跨层级的同一部剧
        const mergedGroups = {};
        for (const [groupPath, data] of Object.entries(parentGroups)) {
            const pathParts = groupPath.split('/');
            const lastName = pathParts[pathParts.length - 1];
            let merged = false;
            if (pathParts.length > 1) {
                for (const [otherPath, otherData] of Object.entries(parentGroups)) {
                    if (otherPath === groupPath) continue;
                    if (otherData.seasons.length > 0 && lastName === otherPath) {
                        // 深层路径的单文件夹 → 合并到以它为 parent 的分季组
                        otherData.files.push(...data.files);
                        merged = true;
                        break;
                    }
                }
            }
            if (!merged) mergedGroups[groupPath] = data;
        }
        parentGroups = mergedGroups;  // 用合并后的替换

        // Step 3: 构建分组结果
        const groups = [];
        for (const [groupPath, data] of Object.entries(parentGroups)) {
            if (data.files.length === 0) continue;

            const parts = groupPath.split('/');
            let title = '';
            let titleFromMap = false;
            for (let i = parts.length - 1; i >= 0; i--) {
                const p = parts[i];
                if (!p || p === '__root__' || SKIP_FOLDERS.has(p)) continue;
                if (extractSeason(p) !== null) continue;
                // 优先查 MEDIA_NAME_MAP 字典（用原始文件夹名精确匹配）
                if (MEDIA_NAME_MAP[p]) {
                    title = MEDIA_NAME_MAP[p];
                    titleFromMap = true;
                } else {
                    // 清理标题（去括号、去版本号等）
                    const cleaned = cleanTitle(p);
                    title = cleaned || p;
                }
                break;
            }

            // 拼音检查（仅在未命中字典时执行）
            let pinyinResult = null;
            if (!titleFromMap) {
                pinyinResult = resolvePinyinFolder(title);
                if (pinyinResult) title = pinyinResult;
            }

            // 类型判断：优先用文件夹路径中的分类关键词
            const fullPath = groupPath.toLowerCase();
            // 将路径按 / 和  /  拆分，检查每个路径段
            const pathSegments = new Set(groupPath.split(/\/|\s+\/\s+/).map(s => s.trim()).filter(Boolean));
            // 动漫文件夹可能混有电影（单文件）和剧集（多集），不强制类型，留给启发式分析
            const PATH_TV_HINTS = ['电视剧', '综艺', '纪录片', 'tv', 'series'];
            // 电影文件夹确定都是电影
            const PATH_MOVIE_HINTS = ['电影', 'movie', 'film'];

            let pathMediaType = null; // null = 路径无分类信息
            // 双重检测：完整路径 contains + 路径段精确匹配
            if (PATH_TV_HINTS.some(h => fullPath.includes(h) || pathSegments.has(h.toLowerCase()))) pathMediaType = 'tv';
            else if (PATH_MOVIE_HINTS.some(h => fullPath.includes(h) || pathSegments.has(h.toLowerCase()))) pathMediaType = 'movie';

            // 兜底：检查组内文件的原始 folderPath（可能包含未被规范化的分类关键词）
            if (!pathMediaType) {
                for (const f of data.files.slice(0, 3)) {
                    const fp = (f.folderPath || '').toLowerCase();
                    if (PATH_TV_HINTS.some(h => fp.includes(h))) { pathMediaType = 'tv'; break; }
                    if (PATH_MOVIE_HINTS.some(h => fp.includes(h))) { pathMediaType = 'movie'; break; }
                }
            }

            let mediaType = pathMediaType || (data.files.length >= 3 ? 'tv' : 'movie');
            // 调试：路径分类结果
            if (title && title.length >= 2) {
                console.log('[Group] 路径分类: "' + title + '" → pathMediaType=' + pathMediaType + ', default=' + (pathMediaType || (data.files.length >= 3 ? 'tv' : 'movie')) + ', files=' + data.files.length + ', path=' + groupPath.substring(Math.max(0, groupPath.length - 60)));
            }
            let isMovieCollection = false;

            // 路径已明确分类 → 直接信任，不做文件名猜谜
            if (pathMediaType === 'movie' && data.files.length >= 2 && !data.seasons.length) {
                isMovieCollection = true;
                mediaType = 'movie';
            } else if (pathMediaType === 'tv') {
                isMovieCollection = false;
                mediaType = 'tv';
            }

            // 路径无分类信息 → 靠文件名分析
            if (!pathMediaType && data.files.length >= 3 && !data.seasons.length) {
                // 找文件名的公共前缀
                const fileNames = data.files.map(f => (f.name || '').replace(/\.[^.]+$/, ''));
                const commonPrefix = findCommonPrefix(fileNames);

                // 如果公共前缀匹配文件夹标题 → 这是一个系列，不是电影集合
                const prefixMatchesTitle = commonPrefix && commonPrefix.length >= 2 && title &&
                    title.length >= 2 &&
                    (commonPrefix.includes(title) || title.includes(commonPrefix));

                // 文件名有公共前缀（如 68.[三国演义].mkv, 30.[三国演义].mkv）→ 剧集，不是电影集合
                const hasCommonPrefix = commonPrefix && commonPrefix.length >= 2;

                // 有公共前缀就直接判为剧集，不拆
                if (hasCommonPrefix || prefixMatchesTitle) {
                    isMovieCollection = false;
                    mediaType = 'tv';
                } else {
                    // 额外检查：文件名是否符合剧集编号模式
                    const episodePatternCount = data.files.filter(f => {
                        const name = (f.name || '').replace(/\.[^.]+$/, '');
                        return /[Ee]\d{1,4}/i.test(name)
                            || /EP\d{1,4}/i.test(name)
                            || /第\d+[集话]/.test(name)
                            || /【\d+】/.test(name)
                            || /\[\d+\]/.test(name)
                            || /^\d{1,4}$/.test(name);
                    }).length;
                    const looksLikeSeries = episodePatternCount >= data.files.length * 0.5;

                    if (!looksLikeSeries) {
                        const descriptiveCount = data.files.filter(f => {
                            const name = (f.name || '').replace(/\.[^.]+$/, '');
                            return /[\u4e00-\u9fff]/.test(name) && !/^\d{1,4}$/.test(name) && !/第\d+[集话]/.test(name);
                        }).length;
                        if (descriptiveCount > data.files.length * 0.6) {
                            isMovieCollection = true;
                            mediaType = 'movie';
                        }
                    }
                }
            }

            if (!isMovieCollection) {
                if (data.files.length >= 3) mediaType = 'tv';
                if (data.seasons.length > 0) mediaType = 'tv';
                for (const f of data.files.slice(0, 5)) {
                    const detected = detectMediaType(f);
                    if (detected === 'tv') { mediaType = 'tv'; break; }
                }
            }

            // 电影集合：每个文件独立成组
            if (isMovieCollection && mediaType === 'movie') {
                for (const f of data.files) {
                    const rawName = f.name || '';
                    const fileName = rawName.replace(/\.[^.]+$/, '');
                    let movieTitle;
                    let fromMap = false;
                    // 先查 MEDIA_NAME_MAP（原始文件名精确匹配 > 去扩展名匹配）
                    if (MEDIA_NAME_MAP[rawName]) {
                        movieTitle = MEDIA_NAME_MAP[rawName];
                        fromMap = true;
                    } else if (MEDIA_NAME_MAP[fileName]) {
                        movieTitle = MEDIA_NAME_MAP[fileName];
                        fromMap = true;
                    } else {
                        movieTitle = cleanTitle(fileName) || fileName;
                    }
                    const pinyinRes = fromMap ? null : resolvePinyinFolder(movieTitle);
                    groups.push({
                        id: 'grp-' + movieTitle.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_').substring(0, 30),
                        title: pinyinRes || movieTitle,
                        mediaType: 'movie',
                        seasons: [{ num: 1, name: '默认', episodes: [{ file: f, epNum: 1, epNameExpected: null }] }],
                        folderPath: groupPath,
                        fileCount: 1,
                        _scrapeTitle: pinyinRes || movieTitle,
                        _isPinyinDetected: !!pinyinRes,
                        _needAI: false,
                    });
                }
                continue;
            }

            // 构建 seasons（合并独立文件 + 分季文件）
            const seasons = [];
            if (data.seasons.length > 0) {
                for (const s of data.seasons) {
                    seasons.push({ num: s.num, name: s.name, episodes: assignEpisodes(s.files) });
                }
                // 独立文件（不在任何分季中的）作为第一季
                const seasonFilePaths = new Set();
                for (const s of data.seasons) {
                    for (const f of s.files) seasonFilePaths.add(f.name + '|||' + (f.folderPath || ''));
                }
                const orphanFiles = data.files.filter(f => !seasonFilePaths.has(f.name + '|||' + (f.folderPath || '')));
                if (orphanFiles.length > 0) {
                    seasons.unshift({ num: 1, name: '默认', episodes: assignEpisodes(orphanFiles) });
                    // 重新编号分季（如果孤文件占用了S1）
                    for (let idx = 1; idx < seasons.length; idx++) {
                        if (seasons[idx].num === 1) seasons[idx].num = idx + 1;
                    }
                }
            } else {
                seasons.push({ num: 1, name: '默认', episodes: assignEpisodes(data.files) });
            }

            groups.push({
                id: 'grp-' + groupPath.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_').substring(0, 40),
                title,
                mediaType,
                seasons,
                folderPath: groupPath,
                fileCount: data.files.length,
                _scrapeTitle: title,
                _isPinyinDetected: pinyinResult !== null,
                _needAI: pinyinResult === null && !/[\u4e00-\u9fff]/.test(title) && title.length > 2,
            });
        }

        return groups;
    }

    /**
     * 批量刮削一个文件夹组（整部剧/电影）
     * @returns {Array} metadata records for each episode
     */
    async function scrapeGroup(group) {
        const results = [];
        const MAX_STEP_TIME = 15000; // 单步最多 15 秒

        const title = group._scrapeTitle || group.title;
        console.log('[ScrapeGroup] 刮削: ' + title + ' (' + group.mediaType + ', ' + group.fileCount + ' 文件, LLM: ' + (group._llmAnalyzed ? '已分析' : '未分析') + ')');
        if (!title || title.length < 2) {
            console.warn('[ScrapeGroup] 标题为空或太短, 跳过');
            return results;
        }

        const withTimeout = (promise, label) =>
            Promise.race([
                promise,
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('超时(' + (MAX_STEP_TIME/1000) + 's): ' + label)), MAX_STEP_TIME)
                )
            ]);

        try {
            console.log('[ScrapeGroup] TMDB搜索: ' + title);
            const searchResult = await withTimeout(
                smartSearch(title, group.mediaType, { name: title, folderPath: group.folderPath }),
                '搜索 ' + title
            );
            if (!searchResult) {
                group._scrapeError = '未找到 "' + title + '"，请检查剧名或手动搜索';
                console.warn('[ScrapeGroup] 搜索无结果: ' + title);
                return results;
            }
            console.log('[ScrapeGroup] 搜索成功: ' + title + ' -> TMDB ID ' + searchResult.id);

            const tmdbId = searchResult.id;
            const mediaType = searchResult.media_type || group.mediaType || 'movie';
            console.log('[ScrapeGroup] 获取详情: TMDB ID ' + tmdbId);
            const details = await withTimeout(
                getDetails(tmdbId, mediaType),
                '获取详情 ' + title
            );
            const baseMeta = extractMetadata(details, mediaType);
            console.log('[ScrapeGroup] 详情获取完成: ' + (baseMeta ? baseMeta.title : '失败'));

            if (!baseMeta) {
                group._scrapeError = '获取 "' + title + '" 详情失败';
                return results;
            }

            group._tmdbId = tmdbId;
            group._mediaType = mediaType;

            // 电影模式
            if (mediaType !== 'tv') {
                
                for (const season of group.seasons) {
                    for (const ep of season.episodes) {
                        results.push({
                            ...baseMeta,
                            id: null, movieId: null, updatedAt: Date.now(),
                            episodeName: null, episodeOverview: null, episodeStill: null,
                            episodeNumber: ep.epNum, seasonNumber: 1,
                        });
                    }
                }
                return results;
            }

            // 电视剧模式
            
            for (const season of group.seasons) {
                const seasonNum = season.num;
                let epData = null;
                try {
                    console.log('[ScrapeGroup] 获取 S' + seasonNum + ' 分集数据 (' + season.episodes.length + ' 集)');
                    epData = await withTimeout(
                        fetchSeasonEpisodes(tmdbId, seasonNum),
                        'S' + seasonNum + ' 分集数据'
                    );
                    console.log('[ScrapeGroup] S' + seasonNum + ' 分集获取完成');
                } catch (e) {
                    console.warn('[ScrapeGroup] 获取 S' + seasonNum + ' 分集失败:', e.message);
                }

                for (const ep of season.episodes) {
                    const epInfo = (epData && epData[ep.epNum]) || null;
                    results.push({
                        ...baseMeta,
                        id: null, movieId: null, updatedAt: Date.now(),
                        episodeName: epInfo ? epInfo.name : null,
                        episodeOverview: epInfo ? epInfo.overview : null,
                        episodeStill: epInfo ? epInfo.stillPath : null,
                        episodeNumber: ep.epNum,
                        seasonNumber: seasonNum,
                    });
                }
            }
            

        } catch (e) {
            console.error('[ScrapeGroup] 刮削异常: ' + title, e);
            group._scrapeError = '刮削异常: ' + e.message;
        }

        return results;

        return results;
    }

    return {
        cleanTitle,
        getTitleFromFile,
        detectMediaType,
        extractYear,
        extractSeason,
        generateSearchQueries,
        resolveTitle,
        scrapeFile,
        scrapeFiles,
        searchTMDB,
        smartSearch,
        searchSuggestions,
        scrapeByTmdbId,
        scrapeByQuery,
        getDetails,
        extractMetadata,
        extractEpisodeNumber,
        fetchSeasonEpisodes,
        // Batch import
        resolvePinyinFolder,
        extractEpisodeFromFileName,
        findCommonPrefix,
        assignEpisodes,
        analyzeImportGroups,
        scrapeGroup,
        TMDB_IMAGE_BASE,
        SKIP_FOLDERS,
    };
})();
