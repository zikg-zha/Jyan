'use strict';
/**
 * 初始化演示数据（幂等：已有家庭则跳过，可用 --force 重置）
 * 覆盖验收标准：≥20 道菜品、20 个订单（进行中/已完成/已取消）、忌口成员
 */
const { db, migrate } = require('./lib/db');
const { STATUS, toDateStr } = require('./lib/domain');

const FAMILY_NAME = '幸福一家';
const INVITE_CODE = 'JIAYAN2026';

const MEMBERS = [
  { name: '妈妈', password: '123456', role: 'admin', taboos: [], specialties: ['红烧肉', '酸菜鱼'], preference: '清淡为主' },
  { name: '爸爸', password: '123456', role: 'member', taboos: [], specialties: ['糖醋排骨', '宫保鸡丁'], preference: '喜欢下厨' },
  { name: '哥哥', password: '123456', role: 'member', taboos: [], specialties: ['番茄炒蛋'], preference: '重口味、爱吃辣' },
  { name: '妹妹', password: '123456', role: 'member', taboos: ['香菜'], specialties: [], preference: '爱吃甜口' },
  { name: '爷爷', password: '123456', role: 'member', taboos: ['海鲜', '虾'], specialties: ['手擀面'], preference: '软烂好嚼' },
];

function steps(list) {
  return list.map((s, i) => ({ title: s[0], desc: s[1], photo: '' }));
}
function ing(list) {
  return list.map(([name, amount, unit]) => ({ name, amount, unit }));
}

const DISHES = [
  { name: '宫保鸡丁', category: '荤菜', difficulty: '中等', duration: 30, servings: 2, icon: 'fa-drumstick-bite',
    ingredients: ing([['鸡胸肉', '300', 'g'], ['花生米', '80', 'g'], ['干辣椒', '10', 'g'], ['葱', '2', '根'], ['姜蒜', '适量', ''], ['花椒', '5', 'g']]),
    steps: steps([['备料', '鸡肉切丁腌制 15 分钟，配菜切好，调好料汁'], ['炒鸡丁', '热油下鸡丁滑炒至变色盛出'], ['爆香', '下干辣椒、花椒、葱姜蒜爆香'], ['合炒收汁', '回锅倒入料汁翻炒，加花生米出锅']]) },
  { name: '红烧肉', category: '荤菜', difficulty: '中等', duration: 60, servings: 3, icon: 'fa-bacon',
    ingredients: ing([['五花肉', '500', 'g'], ['冰糖', '30', 'g'], ['生抽', '2', '勺'], ['老抽', '1', '勺'], ['八角', '2', '颗'], ['姜', '3', '片']]),
    steps: steps([['焯水', '五花肉切块冷水下锅焯去血沫'], ['炒糖色', '冰糖小火炒至琥珀色'], ['上色翻炒', '下肉块翻炒均匀，加生抽老抽'], ['小火慢炖', '加热水与香料炖 45 分钟'], ['收汁', '大火收浓汤汁即可']]) },
  { name: '糖醋排骨', category: '荤菜', difficulty: '中等', duration: 45, servings: 3, icon: 'fa-drumstick-bite',
    ingredients: ing([['肋排', '500', 'g'], ['番茄酱', '3', '勺'], ['白醋', '2', '勺'], ['白糖', '2', '勺'], ['料酒', '1', '勺']]),
    steps: steps([['腌制', '排骨加料酒姜片腌 20 分钟'], ['炸制', '排骨下锅炸至表面金黄'], ['调汁', '番茄酱、醋、糖调成糖醋汁'], ['裹汁', '排骨回锅倒汁收浓裹匀']]) },
  { name: '清蒸鲈鱼', category: '荤菜', difficulty: '简单', duration: 25, servings: 3, icon: 'fa-fish',
    ingredients: ing([['鲈鱼', '1', '条'], ['葱', '3', '根'], ['姜', '5', '片'], ['蒸鱼豉油', '3', '勺'], ['料酒', '1', '勺']]),
    steps: steps([['处理', '鲈鱼洗净打花刀，抹料酒去腥'], ['铺垫', '盘底铺葱姜，鱼身塞姜片'], ['上锅蒸', '水开后大火蒸 8 分钟'], ['淋汁', '倒掉腥水，撒葱丝淋热油与豉油']]) },
  { name: '酸菜鱼', category: '荤菜', difficulty: '困难', duration: 40, servings: 4, icon: 'fa-fish',
    ingredients: ing([['草鱼', '1', '条'], ['酸菜', '200', 'g'], ['泡椒', '5', '个'], ['蛋清', '1', '个'], ['淀粉', '1', '勺']]),
    steps: steps([['片鱼', '鱼肉片成薄片，鱼骨另放'], ['上浆', '鱼片加蛋清淀粉抓匀腌 10 分钟'], ['炒酸菜', '酸菜泡椒下锅炒香，加水煮出味'], ['煮鱼骨', '先下鱼骨煮 5 分钟'], ['汆鱼片', '关小火下鱼片汆熟，淋热油出锅']]) },
  { name: '炒青菜', category: '素菜', difficulty: '简单', duration: 10, servings: 2, icon: 'fa-leaf',
    ingredients: ing([['小青菜', '400', 'g'], ['蒜', '3', '瓣'], ['盐', '适量', ''], ['食用油', '1', '勺']]),
    steps: steps([['洗切', '青菜洗净沥干，蒜切片'], ['爆香', '热锅热油下蒜片爆香'], ['快炒', '下青菜大火快炒至软，加盐出锅']]) },
  { name: '凉拌黄瓜', category: '凉菜', difficulty: '简单', duration: 8, servings: 2, icon: 'fa-seedling',
    ingredients: ing([['黄瓜', '2', '根'], ['香菜', '20', 'g'], ['蒜', '3', '瓣'], ['香醋', '1', '勺'], ['香油', '半', '勺']]),
    steps: steps([['拍黄瓜', '黄瓜拍裂切段，撒盐腌 5 分钟'], ['调味', '蒜末、香醋、香油、少许糖调汁'], ['拌匀', '倒掉黄瓜出水，淋汁撒香菜拌匀']]) },
  { name: '番茄鸡蛋汤', category: '汤', difficulty: '简单', duration: 15, servings: 3, icon: 'fa-mug-hot',
    ingredients: ing([['番茄', '2', '个'], ['鸡蛋', '2', '个'], ['葱花', '适量', ''], ['盐', '适量', '']]),
    steps: steps([['炒番茄', '番茄切块下锅炒出汁'], ['加水煮', '加适量清水煮开'], ['淋蛋液', '蛋液缓慢淋入搅成蛋花'], ['调味', '加盐撒葱花出锅']]) },
  { name: '米饭', category: '主食', difficulty: '简单', duration: 30, servings: 4, icon: 'fa-bowl-rice',
    ingredients: ing([['大米', '2', '杯'], ['清水', '2.2', '杯']]),
    steps: steps([['淘米', '大米淘洗两遍'], ['加水', '按 1:1.1 加水浸泡 10 分钟'], ['电饭煲', '按煮饭键，完成后焖 5 分钟']]) },
  { name: '手撕包菜', category: '素菜', difficulty: '简单', duration: 12, servings: 2, icon: 'fa-leaf',
    ingredients: ing([['包菜', '半', '颗'], ['干辣椒', '5', '个'], ['蒜', '3', '瓣'], ['生抽', '1', '勺'], ['香醋', '半', '勺']]),
    steps: steps([['手撕', '包菜手撕成片洗净沥干'], ['爆香', '干辣椒蒜片下热油爆香'], ['大火炒', '下包菜大火翻炒'], ['调味', '加生抽香醋炒匀出锅']]) },
  { name: '可乐鸡翅', category: '荤菜', difficulty: '简单', duration: 30, servings: 3, icon: 'fa-drumstick-bite',
    ingredients: ing([['鸡中翅', '10', '个'], ['可乐', '1', '罐'], ['生抽', '2', '勺'], ['姜', '3', '片']]),
    steps: steps([['划刀', '鸡翅两面划刀便于入味'], ['煎制', '下锅煎至两面金黄'], ['焖煮', '倒可乐生抽姜片焖 15 分钟'], ['收汁', '大火收汁至浓稠裹匀']]) },
  { name: '麻婆豆腐', category: '荤菜', difficulty: '中等', duration: 25, servings: 3, icon: 'fa-pepper-hot',
    ingredients: ing([['嫩豆腐', '1', '盒'], ['牛肉末', '100', 'g'], ['豆瓣酱', '1', '勺'], ['花椒粉', '适量', ''], ['淀粉水', '半', '碗']]),
    steps: steps([['豆腐焯水', '豆腐切块淡盐水焯 2 分钟'], ['炒肉末', '牛肉末炒散出油'], ['下酱', '加豆瓣酱炒出红油，加水烧开'], ['烩豆腐', '下豆腐轻推，淋淀粉水收汁'], ['撒花椒粉', '出锅撒花椒粉与葱花']]) },
  { name: '西红柿炒蛋', category: '荤菜', difficulty: '简单', duration: 15, servings: 2, icon: 'fa-egg',
    ingredients: ing([['番茄', '3', '个'], ['鸡蛋', '3', '个'], ['白糖', '半', '勺'], ['盐', '适量', '']]),
    steps: steps([['炒蛋', '蛋液炒成块盛出'], ['炒番茄', '番茄下锅炒出浓汁，加糖'], ['合炒', '回锅炒蛋翻匀，加盐出锅']]) },
  { name: '蒜蓉西兰花', category: '素菜', difficulty: '简单', duration: 12, servings: 2, icon: 'fa-leaf',
    ingredients: ing([['西兰花', '1', '颗'], ['蒜', '4', '瓣'], ['盐', '适量', ''], ['蚝油', '1', '勺']]),
    steps: steps([['焯水', '西兰花掰小朵开水焯 1 分钟'], ['爆香蒜', '蒜末下油锅炒香'], ['翻炒调味', '下西兰花加蚝油盐炒匀']]) },
  { name: '冬瓜排骨汤', category: '汤', difficulty: '简单', duration: 60, servings: 4, icon: 'fa-mug-hot',
    ingredients: ing([['排骨', '400', 'g'], ['冬瓜', '300', 'g'], ['姜', '3', '片'], ['盐', '适量', '']]),
    steps: steps([['焯排骨', '排骨冷水焯去血沫洗净'], ['炖煮', '加姜片清水炖 40 分钟'], ['下冬瓜', '冬瓜切块再炖 10 分钟'], ['调味', '加盐调味出锅']]) },
  { name: '紫菜蛋花汤', category: '汤', difficulty: '简单', duration: 10, servings: 3, icon: 'fa-mug-hot',
    ingredients: ing([['紫菜', '10', 'g'], ['鸡蛋', '1', '个'], ['虾皮', '5', 'g'], ['香油', '几', '滴']]),
    steps: steps([['泡紫菜', '紫菜撕碎温水泡开'], ['煮水', '清水加虾皮煮开'], ['淋蛋液', '蛋液淋入成蛋花'], ['调味', '加紫菜、盐、香油出锅']]) },
  { name: '阳春面', category: '主食', difficulty: '简单', duration: 15, servings: 2, icon: 'fa-bowl-food',
    ingredients: ing([['细面', '200', 'g'], ['猪油', '1', '勺'], ['生抽', '2', '勺'], ['葱花', '适量', '']]),
    steps: steps([['调底汤', '碗底放猪油生抽葱花'], ['冲汤', '倒入滚烫面汤化开'], ['煮面', '面条煮熟捞入碗中拌匀']]) },
  { name: '蛋炒饭', category: '主食', difficulty: '简单', duration: 15, servings: 2, icon: 'fa-bowl-rice',
    ingredients: ing([['隔夜米饭', '2', '碗'], ['鸡蛋', '2', '个'], ['胡萝卜', '半', '根'], ['葱花', '适量', '']]),
    steps: steps([['炒蛋', '蛋液下锅炒散盛出'], ['炒配菜', '胡萝卜丁炒软'], ['炒饭', '下米饭压散翻炒，回锅鸡蛋'], ['调味', '加盐生抽葱花炒匀']]) },
  { name: '口水鸡', category: '凉菜', difficulty: '中等', duration: 40, servings: 3, icon: 'fa-drumstick-bite',
    ingredients: ing([['鸡腿', '3', '个'], ['花椒', '5', 'g'], ['辣椒油', '2', '勺'], ['香菜', '20', 'g'], ['花生碎', '30', 'g']]),
    steps: steps([['煮鸡', '鸡腿加葱姜煮 15 分钟后冰水浸凉'], ['调红油汁', '辣椒油、生抽、醋、糖、花椒粉调汁'], ['切件', '鸡腿去骨切块摆盘'], ['浇汁', '淋红油汁撒花生碎香菜']]) },
  { name: '拍黄瓜拌木耳', category: '凉菜', difficulty: '简单', duration: 15, servings: 2, icon: 'fa-seedling',
    ingredients: ing([['黄瓜', '1', '根'], ['干木耳', '15', 'g'], ['蒜', '3', '瓣'], ['生抽', '1', '勺'], ['香醋', '1', '勺']]),
    steps: steps([['泡木耳', '木耳温水泡发洗净焯水'], ['拍黄瓜', '黄瓜拍裂切块'], ['调汁拌匀', '蒜末生抽香醋香油调汁拌匀']]) },
  { name: '干煸四季豆', category: '素菜', difficulty: '中等', duration: 20, servings: 2, icon: 'fa-leaf',
    ingredients: ing([['四季豆', '400', 'g'], ['肉末', '50', 'g'], ['干辣椒', '5', '个'], ['蒜', '3', '瓣']]),
    steps: steps([['处理', '四季豆去筋掰段洗净沥干'], ['干煸', '少油中火煸至表皮起皱'], ['炒香', '下肉末干辣椒蒜末炒香'], ['合炒', '回锅四季豆加盐生抽炒匀']]) },
  { name: '小鸡炖蘑菇', category: '荤菜', difficulty: '中等', duration: 50, servings: 4, icon: 'fa-drumstick-bite',
    ingredients: ing([['土鸡', '半', '只'], ['干榛蘑', '50', 'g'], ['生抽', '2', '勺'], ['姜', '4', '片'], ['粉条', '100', 'g']]),
    steps: steps([['泡蘑菇', '榛蘑温水泡发洗净'], ['炒鸡块', '鸡块下锅炒至变色'], ['调味', '加生抽姜片炒匀，加热水'], ['炖煮', '下蘑菇小火炖 30 分钟'], ['下粉条', '加粉条再煮 8 分钟']]) },
];

/** 生成 20 个订单，覆盖进行中/已完成/已取消 */
function orderPlan(today, yesterday, dayBefore, tomorrow) {
  return [
    // 今日进行中（8 个，覆盖各状态）
    { creator: '妈妈', taker: '爸爸', status: STATUS.COOKING, meal_time: '今天晚饭', date: today, people: 3, dishes: ['酸菜鱼', '炒青菜'], note: '少放辣，鱼要新鲜' },
    { creator: '妹妹', taker: '妈妈', status: STATUS.SHOPPING, meal_time: '今天晚饭', date: today, people: 4, dishes: ['糖醋排骨', '清蒸鲈鱼'], note: '家庭聚餐' },
    { creator: '哥哥', taker: null, status: STATUS.PENDING, meal_time: '今天晚饭', date: today, people: 2, dishes: ['红烧肉'], note: '想吃家里的味道' },
    { creator: '爷爷', taker: '妈妈', status: STATUS.PREPPING, meal_time: '今天晚饭', date: today, people: 5, dishes: ['冬瓜排骨汤', '蒜蓉西兰花'], note: '炖烂一点' },
    { creator: '爸爸', taker: '哥哥', status: STATUS.TAKEN, meal_time: '今天晚饭', date: today, people: 2, dishes: ['西红柿炒蛋', '米饭'], note: '' },
    { creator: '妈妈', taker: null, status: STATUS.PENDING, meal_time: '今天午饭', date: today, people: 3, dishes: ['蛋炒饭'], note: '多放葱花' },
    { creator: '哥哥', taker: '爸爸', status: STATUS.COOKING, meal_time: '今天晚饭', date: today, people: 4, dishes: ['麻婆豆腐', '干煸四季豆'], note: '多点辣' },
    { creator: '妹妹', taker: null, status: STATUS.PENDING, meal_time: '今天晚饭', date: today, people: 2, dishes: ['可乐鸡翅'], note: '甜一点' },
    // 明天进行中（2 个）
    { creator: '哥哥', taker: null, status: STATUS.PENDING, meal_time: '明天午饭', date: tomorrow, people: 4, dishes: ['宫保鸡丁', '紫菜蛋花汤'], note: '' },
    { creator: '爷爷', taker: '妈妈', status: STATUS.TAKEN, meal_time: '明天晚饭', date: tomorrow, people: 5, dishes: ['小鸡炖蘑菇'], note: '不要太咸' },
    // 已完成（8 个，撑起贡献榜）
    { creator: '妹妹', taker: '妈妈', status: STATUS.DONE, meal_time: '昨天晚饭', date: yesterday, people: 3, dishes: ['宫保鸡丁'], note: '' },
    { creator: '爸爸', taker: '妈妈', status: STATUS.DONE, meal_time: '昨天午饭', date: yesterday, people: 2, dishes: ['番茄鸡蛋汤', '米饭'], note: '' },
    { creator: '妈妈', taker: '爸爸', status: STATUS.DONE, meal_time: '昨天晚饭', date: yesterday, people: 4, dishes: ['红烧肉'], note: '' },
    { creator: '哥哥', taker: '爸爸', status: STATUS.DONE, meal_time: '昨天晚饭', date: yesterday, people: 3, dishes: ['糖醋排骨', '炒青菜'], note: '' },
    { creator: '爷爷', taker: '爸爸', status: STATUS.DONE, meal_time: '前天晚饭', date: dayBefore, people: 5, dishes: ['阳春面'], note: '' },
    { creator: '妈妈', taker: '哥哥', status: STATUS.DONE, meal_time: '前天午饭', date: dayBefore, people: 2, dishes: ['手撕包菜', '米饭'], note: '' },
    { creator: '妹妹', taker: '爸爸', status: STATUS.DONE, meal_time: '前天晚饭', date: dayBefore, people: 3, dishes: ['可乐鸡翅'], note: '' },
    { creator: '爸爸', taker: '妈妈', status: STATUS.DONE, meal_time: '前天午饭', date: dayBefore, people: 4, dishes: ['口水鸡', '紫菜蛋花汤'], note: '' },
    // 已取消（2 个）
    { creator: '哥哥', taker: null, status: STATUS.CANCELED, meal_time: '前天晚饭', date: dayBefore, people: 2, dishes: ['凉拌黄瓜'], note: '临时不吃了' },
    { creator: '妹妹', taker: '妈妈', status: STATUS.CANCELED, meal_time: '昨天午饭', date: yesterday, people: 3, dishes: ['拍黄瓜拌木耳'], note: '改约了外食' },
  ];
}

function shiftDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

function seed({ force = false } = {}) {
  migrate();

  const existing = db.prepare('SELECT id FROM families WHERE invite_code = ?').get(INVITE_CODE);
  if (existing && !force) {
    return { skipped: true, familyId: existing.id };
  }
  if (existing && force) {
    db.prepare('DELETE FROM families WHERE id = ?').run(existing.id);
  }

  const run = db.transaction(() => {
    const familyId = Number(db.prepare('INSERT INTO families (name, invite_code) VALUES (?, ?)')
      .run(FAMILY_NAME, INVITE_CODE).lastInsertRowid);

    const memberIds = {};
    const insMember = db.prepare(`
      INSERT INTO members (family_id, name, avatar_text, password, role, taboos, specialties, preference)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const m of MEMBERS) {
      const id = insMember.run(familyId, m.name, m.name.slice(0, 1), m.password, m.role,
        JSON.stringify(m.taboos), JSON.stringify(m.specialties), m.preference).lastInsertRowid;
      memberIds[m.name] = Number(id);
    }

    const dishIds = {};
    const insDish = db.prepare(`
      INSERT INTO dishes (family_id, name, category, difficulty, duration, servings, icon,
        ingredients, steps, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const d of DISHES) {
      const id = insDish.run(familyId, d.name, d.category, d.difficulty, d.duration, d.servings,
        d.icon, JSON.stringify(d.ingredients), JSON.stringify(d.steps), memberIds['妈妈']).lastInsertRowid;
      dishIds[d.name] = Number(id);
    }

    const today = shiftDate(0);
    const plan = orderPlan(today, shiftDate(-1), shiftDate(-2), shiftDate(1));

    const insOrder = db.prepare(`
      INSERT INTO orders (family_id, creator_id, taker_id, status, meal_time, meal_date,
        people, eat_for, note, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insOrderDish = db.prepare(
      'INSERT INTO order_dishes (order_id, dish_id, name, icon) VALUES (?, ?, ?, ?)'
    );
    const insProgress = db.prepare(
      'INSERT INTO order_progress (order_id, status, member_id, remark) VALUES (?, ?, ?, ?)'
    );
    const bump = db.prepare('UPDATE dishes SET order_count = order_count + 1 WHERE id = ?');
    const FLOW_SEQ = [STATUS.TAKEN, STATUS.SHOPPING, STATUS.PREPPING, STATUS.COOKING, STATUS.DONE];

    for (const o of plan) {
      const takerId = o.taker ? memberIds[o.taker] : null;
      const orderId = Number(insOrder.run(
        familyId, memberIds[o.creator], takerId, o.status, o.meal_time, o.date,
        o.people, '', o.note,
        o.status === STATUS.DONE ? `${o.date} 19:00:00` : null
      ).lastInsertRowid);

      for (const name of o.dishes) {
        const dish = DISHES.find((d) => d.name === name);
        insOrderDish.run(orderId, dishIds[name], name, dish ? dish.icon : 'fa-utensils');
        bump.run(dishIds[name]);
      }

      // 进度轨迹：补齐历史流转
      insProgress.run(orderId, STATUS.PENDING, memberIds[o.creator], '已发起点菜单');
      if (o.status === STATUS.CANCELED) {
        insProgress.run(orderId, STATUS.CANCELED, memberIds[o.creator], o.note || '订单已取消');
      } else if (takerId) {
        const upto = FLOW_SEQ.indexOf(o.status);
        for (let i = 0; i <= upto; i += 1) {
          insProgress.run(orderId, FLOW_SEQ[i], takerId, '');
        }
      }
    }

    // 给每位成员一条欢迎消息
    const insNotif = db.prepare(`
      INSERT INTO notifications (family_id, member_id, type, title, body, icon, icon_color)
      VALUES (?, ?, 'new_order', ?, ?, 'fa-utensils', '#FA6400')
    `);
    for (const name of Object.keys(memberIds)) {
      insNotif.run(familyId, memberIds[name], '欢迎来到家宴', '在这里发起点菜、接单，全家一起把饭做好');
    }

    return familyId;
  });

  const familyId = run();
  return { skipped: false, familyId };
}

if (require.main === module) {
  const force = process.argv.includes('--force');
  const r = seed({ force });
  if (r.skipped) {
    console.log('[seed] 已存在演示数据，跳过（加 --force 可重置）');
  } else {
    const counts = {
      members: db.prepare('SELECT COUNT(*) c FROM members').get().c,
      dishes: db.prepare('SELECT COUNT(*) c FROM dishes').get().c,
      orders: db.prepare('SELECT COUNT(*) c FROM orders').get().c,
    };
    console.log(`[seed] 初始化完成 family=${r.familyId}`, counts);
  }
}

module.exports = { seed, FAMILY_NAME, INVITE_CODE, MEMBERS, DISHES };
