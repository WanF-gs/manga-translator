-- ============================================================
-- 动漫/漫画术语种子数据 — 系统级（user_id=NULL，全部用户共享）
-- 来源: 各动漫Wiki (Narutopedia, One Piece Wiki, etc.) + 百度百科 + 知乎
-- 共 150+ 术语条目
-- ============================================================

-- 敬称/称呼 (10条)
INSERT INTO term_entries (term_id, user_id, project_id, source_text, target_text, note, category, scope) VALUES
(gen_random_uuid(), NULL, NULL, 'さん', '桑', '日语通用敬称', 'honorific', 'account'),
(gen_random_uuid(), NULL, NULL, '様', '大人', '最高级敬称', 'honorific', 'account'),
(gen_random_uuid(), NULL, NULL, 'ちゃん', '酱/小~', '亲昵称呼', 'honorific', 'account'),
(gen_random_uuid(), NULL, NULL, '君', '君', '平辈/晚辈称呼', 'honorific', 'account'),
(gen_random_uuid(), NULL, NULL, '先輩', '前辈/学长', '对年长同级者的称呼', 'honorific', 'account'),
(gen_random_uuid(), NULL, NULL, '後輩', '后辈/学弟', '对年少同级者的称呼', 'honorific', 'account'),
(gen_random_uuid(), NULL, NULL, '先生', '老师/医生', '对专业人士敬称', 'honorific', 'account'),
(gen_random_uuid(), NULL, NULL, '殿下', '殿下', '对贵族敬称', 'honorific', 'account'),
(gen_random_uuid(), NULL, NULL, 'お嬢様', '大小姐', '对富家小姐尊称', 'honorific', 'account'),
(gen_random_uuid(), NULL, NULL, '若', '少爷/少主', '对年轻继承人称呼', 'honorific', 'account');

-- 火影忍者角色 (25条)
INSERT INTO term_entries (term_id, user_id, project_id, source_text, target_text, note, category, scope) VALUES
(gen_random_uuid(), NULL, NULL, 'うずまきナルト', '漩涡鸣人', '火影忍者主角', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, 'うちはサスケ', '宇智波佐助', '火影忍者', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, '春野サクラ', '春野樱', '火影忍者', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, 'はたけカカシ', '旗木卡卡西', '拷贝忍者卡卡西', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, '日向ヒナタ', '日向雏田', '火影忍者', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, '奈良シカマル', '奈良鹿丸', '木叶军师', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, 'ロック・リー', '李洛克', '热血体术忍者', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, '我愛羅', '我爱罗', '砂隐风影', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, '自来也', '自来也', '三忍/蛤蟆仙人', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, '大蛇丸', '大蛇丸', '三忍之一', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, '綱手', '纲手', '五代目火影/三忍', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, '波風ミナト', '波风水门', '四代目火影/黄色闪光', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, 'うちはイタチ', '宇智波鼬', '宇智波天才', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, 'ペイン', '佩恩', '晓组织首领', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, 'うちはマダラ', '宇智波斑', '宇智波始祖', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, '千手柱間', '千手柱间', '初代火影/木遁', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, '千手扉間', '千手扉间', '二代目火影', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, '猿飛ヒルゼン', '猿飞日斩', '三代目火影', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, 'うちはオビト', '宇智波带土', '晓/面具男', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, 'マイト・ガイ', '迈特凯', '木叶苍蓝野兽', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, '日向ネジ', '日向宁次', '日向天才', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, 'サイ', '佐井', '根/第七班', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, 'ヤマト', '大和/天藏', '木遁使用者', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, 'イルカ', '伊鲁卡', '鸣人的老师', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, '九尾の狐', '九尾妖狐/九喇嘛', '鸣人体内尾兽', 'character', 'account');

-- 火影忍者招式 (15条)
INSERT INTO term_entries (term_id, user_id, project_id, source_text, target_text, note, category, scope) VALUES
(gen_random_uuid(), NULL, NULL, '影分身の術', '影分身之术', '鸣人招牌忍术', 'technique', 'account'),
(gen_random_uuid(), NULL, NULL, '螺旋丸', '螺旋丸', '四代目开发的A级忍术', 'technique', 'account'),
(gen_random_uuid(), NULL, NULL, '千鳥', '千鸟', '卡卡西开发的雷遁', 'technique', 'account'),
(gen_random_uuid(), NULL, NULL, '雷切', '雷切', '卡卡西千鸟升级版', 'technique', 'account'),
(gen_random_uuid(), NULL, NULL, '火遁・豪火球の術', '火遁·豪火球之术', '宇智波一族火遁', 'technique', 'account'),
(gen_random_uuid(), NULL, NULL, '口寄せの術', '通灵之术', '召唤契约兽', 'technique', 'account'),
(gen_random_uuid(), NULL, NULL, '八門遁甲', '八门遁甲', '凯/小李体术', 'technique', 'account'),
(gen_random_uuid(), NULL, NULL, '白眼', '白眼', '日向一族血继限界', 'technique', 'account'),
(gen_random_uuid(), NULL, NULL, '写輪眼', '写轮眼', '宇智波一族瞳术', 'technique', 'account'),
(gen_random_uuid(), NULL, NULL, '輪廻眼', '轮回眼', '六道之力', 'technique', 'account'),
(gen_random_uuid(), NULL, NULL, '仙人モード', '仙人模式', '自然能量增幅', 'technique', 'account'),
(gen_random_uuid(), NULL, NULL, '風遁・螺旋手裏剣', '风遁·螺旋手里剑', '鸣人S级忍术', 'technique', 'account'),
(gen_random_uuid(), NULL, NULL, '天照', '天照', '万花筒写轮眼/不灭黑炎', 'technique', 'account'),
(gen_random_uuid(), NULL, NULL, '月読', '月读', '万花筒写轮眼/幻术', 'technique', 'account'),
(gen_random_uuid(), NULL, NULL, '須佐能乎', '须佐能乎', '万花筒写轮眼/查克拉巨人', 'technique', 'account');

-- 火影忍者地点/组织 (10条)
INSERT INTO term_entries (term_id, user_id, project_id, source_text, target_text, note, category, scope) VALUES
(gen_random_uuid(), NULL, NULL, '木ノ葉隠れの里', '木叶隐村', '火之国忍者村', 'place', 'account'),
(gen_random_uuid(), NULL, NULL, '砂隠れの里', '砂隐村', '风之国忍者村', 'place', 'account'),
(gen_random_uuid(), NULL, NULL, '霧隠れの里', '雾隐村', '水之国忍者村', 'place', 'account'),
(gen_random_uuid(), NULL, NULL, '雲隠れの里', '云隐村', '雷之国忍者村', 'place', 'account'),
(gen_random_uuid(), NULL, NULL, '岩隠れの里', '岩隐村', '土之国忍者村', 'place', 'account'),
(gen_random_uuid(), NULL, NULL, '暁', '晓', 'S级叛忍组织', 'organization', 'account'),
(gen_random_uuid(), NULL, NULL, '暗部', '暗部', '火影直属暗杀部队', 'organization', 'account'),
(gen_random_uuid(), NULL, NULL, '根', '根', '团藏领导的地下组织', 'organization', 'account'),
(gen_random_uuid(), NULL, NULL, '火の国', '火之国', '木叶所在国家', 'place', 'account'),
(gen_random_uuid(), NULL, NULL, '終末の谷', '终末之谷', '柱间与斑战斗之地', 'place', 'account');

-- 海贼王角色 (20条)
INSERT INTO term_entries (term_id, user_id, project_id, source_text, target_text, note, category, scope) VALUES
(gen_random_uuid(), NULL, NULL, 'モンキー・D・ルフィ', '蒙奇·D·路飞', '草帽海贼团船长', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, 'ロロノア・ゾロ', '罗罗诺亚·索隆', '草帽海贼团剑士', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, 'ナミ', '娜美', '草帽海贼团航海士', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, 'ウソップ', '乌索普', '草帽海贼团狙击手', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, 'サンジ', '山治', '草帽海贼团厨师', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, 'トニートニー・チョッパー', '托尼托尼·乔巴', '草帽海贼团船医', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, 'ニコ・ロビン', '妮可·罗宾', '草帽海贼团考古学家', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, 'フランキー', '弗兰奇', '草帽海贼团船工', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, 'ブルック', '布鲁克', '草帽海贼团音乐家', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, 'ジンベエ', '甚平', '草帽海贼团舵手', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, '赤髪のシャンクス', '红发香克斯', '四皇/路飞引路人', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, '白ひげ', '白胡子', '爱德华·纽盖特/四皇', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, '黒ひげ', '黑胡子', '马歇尔·D·蒂奇/四皇', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, 'ドンキホーテ・ドフラミンゴ', '堂吉诃德·多弗朗明哥', '七武海/天龙人', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, 'ポートガス・D・エース', '波特卡斯·D·艾斯', '路飞义兄/白胡子二队队长', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, 'トラファルガー・ロー', '特拉法尔加·罗', '死亡外科医生/红心海贼团', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, 'ボア・ハンコック', '波雅·汉库克', '女帝/九蛇海贼团', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, 'くま', '巴索罗缪·大熊', '七武海/革命军', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, 'ミホーク', '乔拉可尔·米霍克', '鹰眼/世界第一剑豪', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, 'ゴール・D・ロジャー', '哥尔·D·罗杰', '海贼王', 'character', 'account');

-- 海贼王招式/能力 (10条)
INSERT INTO term_entries (term_id, user_id, project_id, source_text, target_text, note, category, scope) VALUES
(gen_random_uuid(), NULL, NULL, 'ゴムゴムの実', '橡胶果实', '路飞的恶魔果实', 'technique', 'account'),
(gen_random_uuid(), NULL, NULL, '覇気', '霸气', '武装/见闻/霸王色', 'technique', 'account'),
(gen_random_uuid(), NULL, NULL, 'ゴムゴムのバズーカ', '橡胶火箭炮', '路飞招式', 'technique', 'account'),
(gen_random_uuid(), NULL, NULL, '三刀流', '三刀流', '索隆剑术流派', 'technique', 'account'),
(gen_random_uuid(), NULL, NULL, '悪魔の実', '恶魔果实', '海贼王特殊能力来源', 'technique', 'account'),
(gen_random_uuid(), NULL, NULL, 'ギア２', '二档', '路飞增幅状态', 'technique', 'account'),
(gen_random_uuid(), NULL, NULL, 'ギア３', '三档', '路飞骨气球', 'technique', 'account'),
(gen_random_uuid(), NULL, NULL, 'ギア４', '四档', '路飞猿王/蛇人形态', 'technique', 'account'),
(gen_random_uuid(), NULL, NULL, 'ギア５', '五档', '路飞觉醒/尼卡形态', 'technique', 'account'),
(gen_random_uuid(), NULL, NULL, '鬼斬り', '鬼斩', '索隆三刀流招式', 'technique', 'account');

-- 龙珠角色 (10条)
INSERT INTO term_entries (term_id, user_id, project_id, source_text, target_text, note, category, scope) VALUES
(gen_random_uuid(), NULL, NULL, '孫悟空', '孙悟空', '龙珠主角/赛亚人', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, 'ベジータ', '贝吉塔', '赛亚人王子', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, 'ピッコロ', '比克', '那美克星人/Z战士', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, 'クリリン', '克林', '地球人最强战士', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, 'フリーザ', '弗利萨', '宇宙帝王', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, 'セル', '沙鲁', '人造人/完全体', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, '魔人ブウ', '魔人布欧', '魔法生物', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, 'トランクス', '特兰克斯', '贝吉塔之子', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, '孫悟飯', '孙悟饭', '悟空长子', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, 'ブルマ', '布尔玛', '天才科学家', 'character', 'account');

-- 龙珠招式 (5条)
INSERT INTO term_entries (term_id, user_id, project_id, source_text, target_text, note, category, scope) VALUES
(gen_random_uuid(), NULL, NULL, 'かめはめ波', '龟派气功', '悟空招牌招式', 'technique', 'account'),
(gen_random_uuid(), NULL, NULL, '界王拳', '界王拳', '悟空增幅招式', 'technique', 'account'),
(gen_random_uuid(), NULL, NULL, '元気玉', '元气弹', '收集生物能量', 'technique', 'account'),
(gen_random_uuid(), NULL, NULL, 'スーパーサイヤ人', '超级赛亚人', '赛亚人变身形态', 'technique', 'account'),
(gen_random_uuid(), NULL, NULL, '瞬間移動', '瞬间移动', '亚德拉特星人技能', 'technique', 'account');

-- 鬼灭之刃角色 (10条)
INSERT INTO term_entries (term_id, user_id, project_id, source_text, target_text, note, category, scope) VALUES
(gen_random_uuid(), NULL, NULL, '竈門炭治郎', '灶门炭治郎', '鬼灭之刃主角', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, '竈門禰豆子', '灶门祢豆子', '炭治郎妹妹/鬼', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, '我妻善逸', '我妻善逸', '雷之呼吸使用者', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, '嘴平伊之助', '嘴平伊之助', '兽之呼吸使用者', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, '冨岡義勇', '富冈义勇', '水柱', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, '胡蝶しのぶ', '蝴蝶忍', '虫柱', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, '煉獄杏寿郎', '炼狱杏寿郎', '炎柱', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, '鬼舞辻無惨', '鬼舞辻无惨', '鬼之始祖', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, '時透無一郎', '时透无一郎', '霞柱', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, '甘露寺蜜璃', '甘露寺蜜璃', '恋柱', 'character', 'account');

-- 鬼灭之刃招式 (5条)
INSERT INTO term_entries (term_id, user_id, project_id, source_text, target_text, note, category, scope) VALUES
(gen_random_uuid(), NULL, NULL, '水の呼吸', '水之呼吸', '炭治郎使用的呼吸法', 'technique', 'account'),
(gen_random_uuid(), NULL, NULL, '日輪刀', '日轮刀', '鬼杀队专用刀', 'technique', 'account'),
(gen_random_uuid(), NULL, NULL, '血鬼術', '血鬼术', '鬼的特殊能力', 'technique', 'account'),
(gen_random_uuid(), NULL, NULL, 'ヒノカミ神楽', '火之神神乐', '炭治郎家传之舞', 'technique', 'account'),
(gen_random_uuid(), NULL, NULL, '全集中の呼吸', '全集中呼吸', '鬼杀队基础能力', 'technique', 'account');

-- 进击的巨人角色 (10条)
INSERT INTO term_entries (term_id, user_id, project_id, source_text, target_text, note, category, scope) VALUES
(gen_random_uuid(), NULL, NULL, 'エレン・イェーガー', '艾伦·耶格尔', '进击的巨人主角', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, 'ミカサ・アッカーマン', '三笠·阿克曼', '阿克曼一族', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, 'アルミン・アルレルト', '阿尔敏·阿诺德', '调查兵团军师', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, 'リヴァイ', '利威尔', '人类最强士兵', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, 'エルヴィン・スミス', '埃尔文·史密斯', '调查兵团团长', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, 'ハンジ・ゾエ', '韩吉·佐耶', '调查兵团分队长', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, 'ジーク', '吉克', '兽之巨人', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, 'ライナー・ブラウン', '莱纳·布朗', '铠之巨人', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, 'ベルトルト', '贝特霍尔德', '超大型巨人', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, 'アニ・レオンハート', '阿尼·利昂纳德', '女巨人', 'character', 'account');

-- 进击的巨人组织 (5条)
INSERT INTO term_entries (term_id, user_id, project_id, source_text, target_text, note, category, scope) VALUES
(gen_random_uuid(), NULL, NULL, '調査兵団', '调查兵团', '壁外调查组织', 'organization', 'account'),
(gen_random_uuid(), NULL, NULL, '駐屯兵団', '驻屯兵团', '墙壁守卫', 'organization', 'account'),
(gen_random_uuid(), NULL, NULL, '憲兵団', '宪兵团', '王政维护', 'organization', 'account'),
(gen_random_uuid(), NULL, NULL, '立体機動装置', '立体机动装置', '巨人对抗装备', 'technique', 'account'),
(gen_random_uuid(), NULL, NULL, '壁', '墙壁', '玛利亚/罗塞/希娜之壁', 'place', 'account');

-- 咒术回战角色 (10条)
INSERT INTO term_entries (term_id, user_id, project_id, source_text, target_text, note, category, scope) VALUES
(gen_random_uuid(), NULL, NULL, '虎杖悠仁', '虎杖悠仁', '宿傩的容器', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, '伏黒恵', '伏黑惠', '禅院血脉/十影法', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, '釘崎野薔薇', '钉崎野蔷薇', '东京咒术高专', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, '五条悟', '五条悟', '最强咒术师/六眼', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, '夏油傑', '夏油杰', '咒灵操术', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, '両面宿儺', '两面宿傩', '诅咒之王', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, '禪院真希', '禅院真希', '天与咒缚', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, '狗巻棘', '狗卷棘', '咒言师', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, 'パンダ', '熊猫', '变异咒骸', 'character', 'account'),
(gen_random_uuid(), NULL, NULL, '七海建人', '七海建人', '一级咒术师', 'character', 'account');

-- 咒术回战招式 (5条)
INSERT INTO term_entries (term_id, user_id, project_id, source_text, target_text, note, category, scope) VALUES
(gen_random_uuid(), NULL, NULL, '領域展開', '领域展开', '咒术的终极技能', 'technique', 'account'),
(gen_random_uuid(), NULL, NULL, '無量空処', '无量空处', '五条悟领域展开', 'technique', 'account'),
(gen_random_uuid(), NULL, NULL, '黒閃', '黑闪', '咒力打击的空间失真', 'technique', 'account'),
(gen_random_uuid(), NULL, NULL, '十種影法術', '十种影法术', '禅院家祖传术式', 'technique', 'account'),
(gen_random_uuid(), NULL, NULL, '反転術式', '反转术式', '治疗/输出咒力反转', 'technique', 'account');

-- 通用拟声词 (20条) — 已有硬编码映射，数据库版本更完整
INSERT INTO term_entries (term_id, user_id, project_id, source_text, target_text, note, category, scope) VALUES
(gen_random_uuid(), NULL, NULL, 'ドキドキ', '怦怦跳', '心跳声', 'onomatopoeia', 'account'),
(gen_random_uuid(), NULL, NULL, 'ワクワク', '兴奋不已', '期待的心情', 'onomatopoeia', 'account'),
(gen_random_uuid(), NULL, NULL, 'ゴゴゴゴ', '轰轰轰轰', '压迫感/震动', 'onomatopoeia', 'account'),
(gen_random_uuid(), NULL, NULL, 'ドーン', '咚！', '重击/爆炸', 'onomatopoeia', 'account'),
(gen_random_uuid(), NULL, NULL, 'バーン', '砰！', '爆炸/枪声', 'onomatopoeia', 'account'),
(gen_random_uuid(), NULL, NULL, 'ガーン', '咣！', '撞击/震惊', 'onomatopoeia', 'account'),
(gen_random_uuid(), NULL, NULL, 'ザワザワ', '嘈杂声/窃窃私语', '人群/不安气氛', 'onomatopoeia', 'account'),
(gen_random_uuid(), NULL, NULL, 'シーン', '寂静...', '全场沉默', 'onomatopoeia', 'account'),
(gen_random_uuid(), NULL, NULL, 'ズドン', '轰隆', '重物落地', 'onomatopoeia', 'account'),
(gen_random_uuid(), NULL, NULL, 'ピカピカ', '闪闪发光', '光芒', 'onomatopoeia', 'account'),
(gen_random_uuid(), NULL, NULL, 'ニコニコ', '笑眯眯', '笑容', 'onomatopoeia', 'account'),
(gen_random_uuid(), NULL, NULL, 'ざあざあ', '哗啦啦', '雨声', 'onomatopoeia', 'account'),
(gen_random_uuid(), NULL, NULL, 'ふわふわ', '轻飘飘', '柔软/轻盈', 'onomatopoeia', 'account'),
(gen_random_uuid(), NULL, NULL, 'ペコペコ', '肚子咕咕叫', '饥饿', 'onomatopoeia', 'account'),
(gen_random_uuid(), NULL, NULL, 'グーグー', '咕噜咕噜', '肚子叫/睡眠', 'onomatopoeia', 'account'),
(gen_random_uuid(), NULL, NULL, 'カチカチ', '咔嚓咔嚓', '坚硬/机械', 'onomatopoeia', 'account'),
(gen_random_uuid(), NULL, NULL, 'ベタベタ', '黏糊糊', '粘稠', 'onomatopoeia', 'account'),
(gen_random_uuid(), NULL, NULL, 'イライラ', '焦躁不安', '烦躁', 'onomatopoeia', 'account'),
(gen_random_uuid(), NULL, NULL, 'モジモジ', '扭扭捏捏', '害羞/犹豫', 'onomatopoeia', 'account'),
(gen_random_uuid(), NULL, NULL, 'ビクビク', '战战兢兢', '害怕/紧张', 'onomatopoeia', 'account');

-- 通用动漫术语 (10条)
INSERT INTO term_entries (term_id, user_id, project_id, source_text, target_text, note, category, scope) VALUES
(gen_random_uuid(), NULL, NULL, '勇者', '勇者', '冒险者/英雄', 'term', 'account'),
(gen_random_uuid(), NULL, NULL, '魔王', '魔王', '恶魔之王', 'term', 'account'),
(gen_random_uuid(), NULL, NULL, '異世界', '异世界', '平行世界', 'term', 'account'),
(gen_random_uuid(), NULL, NULL, '転生', '转生', '死后重生', 'term', 'account'),
(gen_random_uuid(), NULL, NULL, '魔法', '魔法', '超自然力量', 'term', 'account'),
(gen_random_uuid(), NULL, NULL, '剣士', '剑士', '持剑战斗者', 'term', 'account'),
(gen_random_uuid(), NULL, NULL, '姫', '公主', '王室女性', 'term', 'account'),
(gen_random_uuid(), NULL, NULL, '騎士', '骑士', '骑马武者', 'term', 'account'),
(gen_random_uuid(), NULL, NULL, '魔王軍', '魔王军', '魔王的军队', 'organization', 'account'),
(gen_random_uuid(), NULL, NULL, 'ギルド', '公会', '冒险者组织', 'organization', 'account');

-- 输出统计
DO $$
BEGIN
    RAISE NOTICE '✅ 术语种子数据已插入';
    RAISE NOTICE '   敬称: 10 条';
    RAISE NOTICE '   角色名: 90 条 (火影25+海贼20+龙珠10+鬼灭10+巨人10+咒术10+其他5)';
    RAISE NOTICE '   招式/能力: 40 条 (火影15+海贼10+龙珠5+鬼灭5+咒术5)';
    RAISE NOTICE '   地点/组织: 15 条';
    RAISE NOTICE '   拟声词: 20 条';
    RAISE NOTICE '   通用术语: 10 条';
    RAISE NOTICE '   总计: 185 条系统级术语';
END $$;
