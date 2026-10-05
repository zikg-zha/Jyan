-- 家宴 · 演示数据：1 个家庭、5 位成员、22 道菜、20 个订单
-- 用法：先执行 schema.sql，再在 SQL Editor 执行本文件；最后一行会输出家庭邀请码（登录时需要）
-- 已有家庭时自动跳过。所有成员初始密码为 123456，上线后请在「我的 → 修改密码」里改掉。

do $seed$
declare
  v_family  bigint;
  v_code    text := upper(substr(md5(gen_random_uuid()::text), 1, 8));
  v_ids     jsonb := '{}'::jsonb;
  v_order   bigint;
  v_o       jsonb;
  v_creator bigint;
  v_taker   bigint;
  v_status  text;
  v_date    date;
  v_today   date := (now() at time zone 'Asia/Shanghai')::date;
  v_flow    text[] := array['已接单', '采购中', '准备中', '烹饪中', '已完成'];
  i         int;
  v_members jsonb := $j$[
    {"name":"妈妈","role":"admin","taboos":[],"specialties":["红烧肉","酸菜鱼"],"preference":"清淡为主"},
    {"name":"爸爸","role":"member","taboos":[],"specialties":["糖醋排骨","宫保鸡丁"],"preference":"喜欢下厨"},
    {"name":"哥哥","role":"member","taboos":[],"specialties":["番茄炒蛋"],"preference":"重口味、爱吃辣"},
    {"name":"妹妹","role":"member","taboos":["香菜"],"specialties":[],"preference":"爱吃甜口"},
    {"name":"爷爷","role":"member","taboos":["海鲜","虾"],"specialties":["手擀面"],"preference":"软烂好嚼"}
  ]$j$;
  v_dishes  jsonb := $j$[
    {"name":"宫保鸡丁","category":"荤菜","difficulty":"中等","duration":30,"servings":2,"icon":"fa-drumstick-bite","ingredients":[{"name":"鸡胸肉","amount":"300","unit":"g"},{"name":"花生米","amount":"80","unit":"g"},{"name":"干辣椒","amount":"10","unit":"g"},{"name":"葱","amount":"2","unit":"根"},{"name":"姜蒜","amount":"适量","unit":""},{"name":"花椒","amount":"5","unit":"g"}],"steps":[{"title":"备料","desc":"鸡肉切丁腌制 15 分钟，配菜切好，调好料汁","photo":""},{"title":"炒鸡丁","desc":"热油下鸡丁滑炒至变色盛出","photo":""},{"title":"爆香","desc":"下干辣椒、花椒、葱姜蒜爆香","photo":""},{"title":"合炒收汁","desc":"回锅倒入料汁翻炒，加花生米出锅","photo":""}]},
    {"name":"红烧肉","category":"荤菜","difficulty":"中等","duration":60,"servings":3,"icon":"fa-bacon","ingredients":[{"name":"五花肉","amount":"500","unit":"g"},{"name":"冰糖","amount":"30","unit":"g"},{"name":"生抽","amount":"2","unit":"勺"},{"name":"老抽","amount":"1","unit":"勺"},{"name":"八角","amount":"2","unit":"颗"},{"name":"姜","amount":"3","unit":"片"}],"steps":[{"title":"焯水","desc":"五花肉切块冷水下锅焯去血沫","photo":""},{"title":"炒糖色","desc":"冰糖小火炒至琥珀色","photo":""},{"title":"上色翻炒","desc":"下肉块翻炒均匀，加生抽老抽","photo":""},{"title":"小火慢炖","desc":"加热水与香料炖 45 分钟","photo":""},{"title":"收汁","desc":"大火收浓汤汁即可","photo":""}]},
    {"name":"糖醋排骨","category":"荤菜","difficulty":"中等","duration":45,"servings":3,"icon":"fa-drumstick-bite","ingredients":[{"name":"肋排","amount":"500","unit":"g"},{"name":"番茄酱","amount":"3","unit":"勺"},{"name":"白醋","amount":"2","unit":"勺"},{"name":"白糖","amount":"2","unit":"勺"},{"name":"料酒","amount":"1","unit":"勺"}],"steps":[{"title":"腌制","desc":"排骨加料酒姜片腌 20 分钟","photo":""},{"title":"炸制","desc":"排骨下锅炸至表面金黄","photo":""},{"title":"调汁","desc":"番茄酱、醋、糖调成糖醋汁","photo":""},{"title":"裹汁","desc":"排骨回锅倒汁收浓裹匀","photo":""}]},
    {"name":"清蒸鲈鱼","category":"荤菜","difficulty":"简单","duration":25,"servings":3,"icon":"fa-fish","ingredients":[{"name":"鲈鱼","amount":"1","unit":"条"},{"name":"葱","amount":"3","unit":"根"},{"name":"姜","amount":"5","unit":"片"},{"name":"蒸鱼豉油","amount":"3","unit":"勺"},{"name":"料酒","amount":"1","unit":"勺"}],"steps":[{"title":"处理","desc":"鲈鱼洗净打花刀，抹料酒去腥","photo":""},{"title":"铺垫","desc":"盘底铺葱姜，鱼身塞姜片","photo":""},{"title":"上锅蒸","desc":"水开后大火蒸 8 分钟","photo":""},{"title":"淋汁","desc":"倒掉腥水，撒葱丝淋热油与豉油","photo":""}]},
    {"name":"酸菜鱼","category":"荤菜","difficulty":"困难","duration":40,"servings":4,"icon":"fa-fish","ingredients":[{"name":"草鱼","amount":"1","unit":"条"},{"name":"酸菜","amount":"200","unit":"g"},{"name":"泡椒","amount":"5","unit":"个"},{"name":"蛋清","amount":"1","unit":"个"},{"name":"淀粉","amount":"1","unit":"勺"}],"steps":[{"title":"片鱼","desc":"鱼肉片成薄片，鱼骨另放","photo":""},{"title":"上浆","desc":"鱼片加蛋清淀粉抓匀腌 10 分钟","photo":""},{"title":"炒酸菜","desc":"酸菜泡椒下锅炒香，加水煮出味","photo":""},{"title":"煮鱼骨","desc":"先下鱼骨煮 5 分钟","photo":""},{"title":"汆鱼片","desc":"关小火下鱼片汆熟，淋热油出锅","photo":""}]},
    {"name":"炒青菜","category":"素菜","difficulty":"简单","duration":10,"servings":2,"icon":"fa-leaf","ingredients":[{"name":"小青菜","amount":"400","unit":"g"},{"name":"蒜","amount":"3","unit":"瓣"},{"name":"盐","amount":"适量","unit":""},{"name":"食用油","amount":"1","unit":"勺"}],"steps":[{"title":"洗切","desc":"青菜洗净沥干，蒜切片","photo":""},{"title":"爆香","desc":"热锅热油下蒜片爆香","photo":""},{"title":"快炒","desc":"下青菜大火快炒至软，加盐出锅","photo":""}]},
    {"name":"凉拌黄瓜","category":"凉菜","difficulty":"简单","duration":8,"servings":2,"icon":"fa-seedling","ingredients":[{"name":"黄瓜","amount":"2","unit":"根"},{"name":"香菜","amount":"20","unit":"g"},{"name":"蒜","amount":"3","unit":"瓣"},{"name":"香醋","amount":"1","unit":"勺"},{"name":"香油","amount":"半","unit":"勺"}],"steps":[{"title":"拍黄瓜","desc":"黄瓜拍裂切段，撒盐腌 5 分钟","photo":""},{"title":"调味","desc":"蒜末、香醋、香油、少许糖调汁","photo":""},{"title":"拌匀","desc":"倒掉黄瓜出水，淋汁撒香菜拌匀","photo":""}]},
    {"name":"番茄鸡蛋汤","category":"汤","difficulty":"简单","duration":15,"servings":3,"icon":"fa-mug-hot","ingredients":[{"name":"番茄","amount":"2","unit":"个"},{"name":"鸡蛋","amount":"2","unit":"个"},{"name":"葱花","amount":"适量","unit":""},{"name":"盐","amount":"适量","unit":""}],"steps":[{"title":"炒番茄","desc":"番茄切块下锅炒出汁","photo":""},{"title":"加水煮","desc":"加适量清水煮开","photo":""},{"title":"淋蛋液","desc":"蛋液缓慢淋入搅成蛋花","photo":""},{"title":"调味","desc":"加盐撒葱花出锅","photo":""}]},
    {"name":"米饭","category":"主食","difficulty":"简单","duration":30,"servings":4,"icon":"fa-bowl-rice","ingredients":[{"name":"大米","amount":"2","unit":"杯"},{"name":"清水","amount":"2.2","unit":"杯"}],"steps":[{"title":"淘米","desc":"大米淘洗两遍","photo":""},{"title":"加水","desc":"按 1:1.1 加水浸泡 10 分钟","photo":""},{"title":"电饭煲","desc":"按煮饭键，完成后焖 5 分钟","photo":""}]},
    {"name":"手撕包菜","category":"素菜","difficulty":"简单","duration":12,"servings":2,"icon":"fa-leaf","ingredients":[{"name":"包菜","amount":"半","unit":"颗"},{"name":"干辣椒","amount":"5","unit":"个"},{"name":"蒜","amount":"3","unit":"瓣"},{"name":"生抽","amount":"1","unit":"勺"},{"name":"香醋","amount":"半","unit":"勺"}],"steps":[{"title":"手撕","desc":"包菜手撕成片洗净沥干","photo":""},{"title":"爆香","desc":"干辣椒蒜片下热油爆香","photo":""},{"title":"大火炒","desc":"下包菜大火翻炒","photo":""},{"title":"调味","desc":"加生抽香醋炒匀出锅","photo":""}]},
    {"name":"可乐鸡翅","category":"荤菜","difficulty":"简单","duration":30,"servings":3,"icon":"fa-drumstick-bite","ingredients":[{"name":"鸡中翅","amount":"10","unit":"个"},{"name":"可乐","amount":"1","unit":"罐"},{"name":"生抽","amount":"2","unit":"勺"},{"name":"姜","amount":"3","unit":"片"}],"steps":[{"title":"划刀","desc":"鸡翅两面划刀便于入味","photo":""},{"title":"煎制","desc":"下锅煎至两面金黄","photo":""},{"title":"焖煮","desc":"倒可乐生抽姜片焖 15 分钟","photo":""},{"title":"收汁","desc":"大火收汁至浓稠裹匀","photo":""}]},
    {"name":"麻婆豆腐","category":"荤菜","difficulty":"中等","duration":25,"servings":3,"icon":"fa-pepper-hot","ingredients":[{"name":"嫩豆腐","amount":"1","unit":"盒"},{"name":"牛肉末","amount":"100","unit":"g"},{"name":"豆瓣酱","amount":"1","unit":"勺"},{"name":"花椒粉","amount":"适量","unit":""},{"name":"淀粉水","amount":"半","unit":"碗"}],"steps":[{"title":"豆腐焯水","desc":"豆腐切块淡盐水焯 2 分钟","photo":""},{"title":"炒肉末","desc":"牛肉末炒散出油","photo":""},{"title":"下酱","desc":"加豆瓣酱炒出红油，加水烧开","photo":""},{"title":"烩豆腐","desc":"下豆腐轻推，淋淀粉水收汁","photo":""},{"title":"撒花椒粉","desc":"出锅撒花椒粉与葱花","photo":""}]},
    {"name":"西红柿炒蛋","category":"荤菜","difficulty":"简单","duration":15,"servings":2,"icon":"fa-egg","ingredients":[{"name":"番茄","amount":"3","unit":"个"},{"name":"鸡蛋","amount":"3","unit":"个"},{"name":"白糖","amount":"半","unit":"勺"},{"name":"盐","amount":"适量","unit":""}],"steps":[{"title":"炒蛋","desc":"蛋液炒成块盛出","photo":""},{"title":"炒番茄","desc":"番茄下锅炒出浓汁，加糖","photo":""},{"title":"合炒","desc":"回锅炒蛋翻匀，加盐出锅","photo":""}]},
    {"name":"蒜蓉西兰花","category":"素菜","difficulty":"简单","duration":12,"servings":2,"icon":"fa-leaf","ingredients":[{"name":"西兰花","amount":"1","unit":"颗"},{"name":"蒜","amount":"4","unit":"瓣"},{"name":"盐","amount":"适量","unit":""},{"name":"蚝油","amount":"1","unit":"勺"}],"steps":[{"title":"焯水","desc":"西兰花掰小朵开水焯 1 分钟","photo":""},{"title":"爆香蒜","desc":"蒜末下油锅炒香","photo":""},{"title":"翻炒调味","desc":"下西兰花加蚝油盐炒匀","photo":""}]},
    {"name":"冬瓜排骨汤","category":"汤","difficulty":"简单","duration":60,"servings":4,"icon":"fa-mug-hot","ingredients":[{"name":"排骨","amount":"400","unit":"g"},{"name":"冬瓜","amount":"300","unit":"g"},{"name":"姜","amount":"3","unit":"片"},{"name":"盐","amount":"适量","unit":""}],"steps":[{"title":"焯排骨","desc":"排骨冷水焯去血沫洗净","photo":""},{"title":"炖煮","desc":"加姜片清水炖 40 分钟","photo":""},{"title":"下冬瓜","desc":"冬瓜切块再炖 10 分钟","photo":""},{"title":"调味","desc":"加盐调味出锅","photo":""}]},
    {"name":"紫菜蛋花汤","category":"汤","difficulty":"简单","duration":10,"servings":3,"icon":"fa-mug-hot","ingredients":[{"name":"紫菜","amount":"10","unit":"g"},{"name":"鸡蛋","amount":"1","unit":"个"},{"name":"虾皮","amount":"5","unit":"g"},{"name":"香油","amount":"几","unit":"滴"}],"steps":[{"title":"泡紫菜","desc":"紫菜撕碎温水泡开","photo":""},{"title":"煮水","desc":"清水加虾皮煮开","photo":""},{"title":"淋蛋液","desc":"蛋液淋入成蛋花","photo":""},{"title":"调味","desc":"加紫菜、盐、香油出锅","photo":""}]},
    {"name":"阳春面","category":"主食","difficulty":"简单","duration":15,"servings":2,"icon":"fa-bowl-food","ingredients":[{"name":"细面","amount":"200","unit":"g"},{"name":"猪油","amount":"1","unit":"勺"},{"name":"生抽","amount":"2","unit":"勺"},{"name":"葱花","amount":"适量","unit":""}],"steps":[{"title":"调底汤","desc":"碗底放猪油生抽葱花","photo":""},{"title":"冲汤","desc":"倒入滚烫面汤化开","photo":""},{"title":"煮面","desc":"面条煮熟捞入碗中拌匀","photo":""}]},
    {"name":"蛋炒饭","category":"主食","difficulty":"简单","duration":15,"servings":2,"icon":"fa-bowl-rice","ingredients":[{"name":"隔夜米饭","amount":"2","unit":"碗"},{"name":"鸡蛋","amount":"2","unit":"个"},{"name":"胡萝卜","amount":"半","unit":"根"},{"name":"葱花","amount":"适量","unit":""}],"steps":[{"title":"炒蛋","desc":"蛋液下锅炒散盛出","photo":""},{"title":"炒配菜","desc":"胡萝卜丁炒软","photo":""},{"title":"炒饭","desc":"下米饭压散翻炒，回锅鸡蛋","photo":""},{"title":"调味","desc":"加盐生抽葱花炒匀","photo":""}]},
    {"name":"口水鸡","category":"凉菜","difficulty":"中等","duration":40,"servings":3,"icon":"fa-drumstick-bite","ingredients":[{"name":"鸡腿","amount":"3","unit":"个"},{"name":"花椒","amount":"5","unit":"g"},{"name":"辣椒油","amount":"2","unit":"勺"},{"name":"香菜","amount":"20","unit":"g"},{"name":"花生碎","amount":"30","unit":"g"}],"steps":[{"title":"煮鸡","desc":"鸡腿加葱姜煮 15 分钟后冰水浸凉","photo":""},{"title":"调红油汁","desc":"辣椒油、生抽、醋、糖、花椒粉调汁","photo":""},{"title":"切件","desc":"鸡腿去骨切块摆盘","photo":""},{"title":"浇汁","desc":"淋红油汁撒花生碎香菜","photo":""}]},
    {"name":"拍黄瓜拌木耳","category":"凉菜","difficulty":"简单","duration":15,"servings":2,"icon":"fa-seedling","ingredients":[{"name":"黄瓜","amount":"1","unit":"根"},{"name":"干木耳","amount":"15","unit":"g"},{"name":"蒜","amount":"3","unit":"瓣"},{"name":"生抽","amount":"1","unit":"勺"},{"name":"香醋","amount":"1","unit":"勺"}],"steps":[{"title":"泡木耳","desc":"木耳温水泡发洗净焯水","photo":""},{"title":"拍黄瓜","desc":"黄瓜拍裂切块","photo":""},{"title":"调汁拌匀","desc":"蒜末生抽香醋香油调汁拌匀","photo":""}]},
    {"name":"干煸四季豆","category":"素菜","difficulty":"中等","duration":20,"servings":2,"icon":"fa-leaf","ingredients":[{"name":"四季豆","amount":"400","unit":"g"},{"name":"肉末","amount":"50","unit":"g"},{"name":"干辣椒","amount":"5","unit":"个"},{"name":"蒜","amount":"3","unit":"瓣"}],"steps":[{"title":"处理","desc":"四季豆去筋掰段洗净沥干","photo":""},{"title":"干煸","desc":"少油中火煸至表皮起皱","photo":""},{"title":"炒香","desc":"下肉末干辣椒蒜末炒香","photo":""},{"title":"合炒","desc":"回锅四季豆加盐生抽炒匀","photo":""}]},
    {"name":"小鸡炖蘑菇","category":"荤菜","difficulty":"中等","duration":50,"servings":4,"icon":"fa-drumstick-bite","ingredients":[{"name":"土鸡","amount":"半","unit":"只"},{"name":"干榛蘑","amount":"50","unit":"g"},{"name":"生抽","amount":"2","unit":"勺"},{"name":"姜","amount":"4","unit":"片"},{"name":"粉条","amount":"100","unit":"g"}],"steps":[{"title":"泡蘑菇","desc":"榛蘑温水泡发洗净","photo":""},{"title":"炒鸡块","desc":"鸡块下锅炒至变色","photo":""},{"title":"调味","desc":"加生抽姜片炒匀，加热水","photo":""},{"title":"炖煮","desc":"下蘑菇小火炖 30 分钟","photo":""},{"title":"下粉条","desc":"加粉条再煮 8 分钟","photo":""}]}
  ]$j$;
  -- d: 相对今天的天数偏移
  v_orders  jsonb := $j$[
    {"c":"妈妈","t":"爸爸","s":"烹饪中","m":"今天晚饭","d":0,"p":3,"dishes":["酸菜鱼","炒青菜"],"n":"少放辣，鱼要新鲜"},
    {"c":"妹妹","t":"妈妈","s":"采购中","m":"今天晚饭","d":0,"p":4,"dishes":["糖醋排骨","清蒸鲈鱼"],"n":"家庭聚餐"},
    {"c":"哥哥","t":null,"s":"待接单","m":"今天晚饭","d":0,"p":2,"dishes":["红烧肉"],"n":"想吃家里的味道"},
    {"c":"爷爷","t":"妈妈","s":"准备中","m":"今天晚饭","d":0,"p":5,"dishes":["冬瓜排骨汤","蒜蓉西兰花"],"n":"炖烂一点"},
    {"c":"爸爸","t":"哥哥","s":"已接单","m":"今天晚饭","d":0,"p":2,"dishes":["西红柿炒蛋","米饭"],"n":""},
    {"c":"妈妈","t":null,"s":"待接单","m":"今天午饭","d":0,"p":3,"dishes":["蛋炒饭"],"n":"多放葱花"},
    {"c":"哥哥","t":"爸爸","s":"烹饪中","m":"今天晚饭","d":0,"p":4,"dishes":["麻婆豆腐","干煸四季豆"],"n":"多点辣"},
    {"c":"妹妹","t":null,"s":"待接单","m":"今天晚饭","d":0,"p":2,"dishes":["可乐鸡翅"],"n":"甜一点"},
    {"c":"哥哥","t":null,"s":"待接单","m":"明天午饭","d":1,"p":4,"dishes":["宫保鸡丁","紫菜蛋花汤"],"n":""},
    {"c":"爷爷","t":"妈妈","s":"已接单","m":"明天晚饭","d":1,"p":5,"dishes":["小鸡炖蘑菇"],"n":"不要太咸"},
    {"c":"妹妹","t":"妈妈","s":"已完成","m":"昨天晚饭","d":-1,"p":3,"dishes":["宫保鸡丁"],"n":""},
    {"c":"爸爸","t":"妈妈","s":"已完成","m":"昨天午饭","d":-1,"p":2,"dishes":["番茄鸡蛋汤","米饭"],"n":""},
    {"c":"妈妈","t":"爸爸","s":"已完成","m":"昨天晚饭","d":-1,"p":4,"dishes":["红烧肉"],"n":""},
    {"c":"哥哥","t":"爸爸","s":"已完成","m":"昨天晚饭","d":-1,"p":3,"dishes":["糖醋排骨","炒青菜"],"n":""},
    {"c":"爷爷","t":"爸爸","s":"已完成","m":"前天晚饭","d":-2,"p":5,"dishes":["阳春面"],"n":""},
    {"c":"妈妈","t":"哥哥","s":"已完成","m":"前天午饭","d":-2,"p":2,"dishes":["手撕包菜","米饭"],"n":""},
    {"c":"妹妹","t":"爸爸","s":"已完成","m":"前天晚饭","d":-2,"p":3,"dishes":["可乐鸡翅"],"n":""},
    {"c":"爸爸","t":"妈妈","s":"已完成","m":"前天午饭","d":-2,"p":4,"dishes":["口水鸡","紫菜蛋花汤"],"n":""},
    {"c":"哥哥","t":null,"s":"已取消","m":"前天晚饭","d":-2,"p":2,"dishes":["凉拌黄瓜"],"n":"临时不吃了"},
    {"c":"妹妹","t":"妈妈","s":"已取消","m":"昨天午饭","d":-1,"p":3,"dishes":["拍黄瓜拌木耳"],"n":"改约了外食"}
  ]$j$;
begin
  if exists (select 1 from public.families) then
    raise notice '[seed] 已存在家庭数据，跳过';
    return;
  end if;

  insert into public.families (name, invite_code) values ('幸福一家', v_code) returning id into v_family;

  with ins as (
    insert into public.members (family_id, name, avatar_text, role, taboos, specialties, preference)
    select v_family, m->>'name', left(m->>'name', 1), m->>'role', m->'taboos', m->'specialties', m->>'preference'
    from jsonb_array_elements(v_members) with ordinality as t(m, n)
    order by n
    returning id, name
  )
  select jsonb_object_agg(name, id) into v_ids from ins;

  insert into private.member_secrets (member_id, password_hash)
  select id, extensions.crypt('123456', extensions.gen_salt('bf', 8))
  from public.members where family_id = v_family;

  insert into public.dishes (family_id, name, category, difficulty, duration, servings, icon,
                             ingredients, steps, created_by)
  select v_family, x->>'name', x->>'category', x->>'difficulty', (x->>'duration')::int,
         (x->>'servings')::int, x->>'icon', x->'ingredients', x->'steps', (v_ids->>'妈妈')::bigint
  from jsonb_array_elements(v_dishes) with ordinality as t(x, n)
  order by n;

  for v_o in select value from jsonb_array_elements(v_orders) loop
    v_creator := (v_ids->>(v_o->>'c'))::bigint;
    v_taker := case when v_o->>'t' is null then null else (v_ids->>(v_o->>'t'))::bigint end;
    v_status := v_o->>'s';
    v_date := v_today + (v_o->>'d')::int;

    insert into public.orders (family_id, creator_id, taker_id, status, meal_time, meal_date,
                               people, note, completed_at)
    values (v_family, v_creator, v_taker, v_status, v_o->>'m', v_date, (v_o->>'p')::int, v_o->>'n',
            case when v_status = '已完成'
                 then (v_date + time '19:00') at time zone 'Asia/Shanghai' end)
    returning id into v_order;

    insert into public.order_dishes (order_id, dish_id, name, icon)
    select v_order, d.id, d.name, d.icon
    from jsonb_array_elements_text(v_o->'dishes') with ordinality as t(dn, n)
    join public.dishes d on d.family_id = v_family and d.name = t.dn
    order by t.n;
    update public.dishes set order_count = order_count + 1
    where family_id = v_family and name in (select jsonb_array_elements_text(v_o->'dishes'));

    -- 补齐历史进度轨迹
    insert into public.order_progress (order_id, status, member_id, remark)
    values (v_order, '待接单', v_creator, '已发起点菜单');
    if v_status = '已取消' then
      insert into public.order_progress (order_id, status, member_id, remark)
      values (v_order, '已取消', v_creator, coalesce(nullif(v_o->>'n', ''), '订单已取消'));
    elsif v_taker is not null then
      for i in 1 .. coalesce(array_position(v_flow, v_status), 0) loop
        insert into public.order_progress (order_id, status, member_id) values (v_order, v_flow[i], v_taker);
      end loop;
    end if;
  end loop;

  insert into public.notifications (family_id, member_id, type, title, body, icon, icon_color)
  select v_family, id, 'new_order', '欢迎来到家宴', '在这里发起点菜、接单，全家一起把饭做好',
         'fa-utensils', '#FA6400'
  from public.members where family_id = v_family order by id;

  raise notice '[seed] 初始化完成，家庭邀请码：%', v_code;
end $seed$;

select name as 家庭, invite_code as 邀请码 from public.families order by id;
