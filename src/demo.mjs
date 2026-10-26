// 示範研究專案的種子：照一般 agent 的流程走一遍（建研究路徑 → 跑實驗 → 登記結論），白板一開始就有內容。
// 寫入者標成 demo-script，不冒充任何 agent。
import { recordRun } from './run.mjs';

// eval/judge.py 裡的那一行：嚴格比對（原版）與寬鬆比對（偷改版）
export const JUDGE_STRICT = 'm = re.search(r"^答案：(\\S+)$", text, re.MULTILINE)';
export const JUDGE_LOOSE = 'm = re.search(r"答案[是為：:]?\\s*(\\S+?)[。.]?\\s*$", text)';

export function seedDemo(ck){
  const A = 'demo-script', w = (type, payload) => ck.write(type, payload, A);
  w('stages_planned', { stages:[
    { id:'P1', title:'選題', out:'講得清楚的研究問題' },
    { id:'P2', title:'文獻與基線', out:'裸底座基線與相關研究' },
    { id:'P3', title:'實驗', out:'有證據鏈的結論', needs:['cockpit_run', 'cockpit_claim'] },
    { id:'P4', title:'裁決', out:'人拍板的終裁', human:true },
  ] });
  w('stage_updated', { id_:'P1', status:'done' });
  w('stage_updated', { id_:'P2', status:'done' });
  w('stage_updated', { id_:'P3', status:'active' });

  const task = (id, title, state, step, progress, summary, why, next) => w('task_upserted', { task:{ id, stage:'P3', title, state, step, progress, summary, why, next, where:'main' } });
  task('T1', '組合臂與純模組評估', 'doing', '第 3/4 步', 75, '跑完組合臂與純模組的雙種子評估', '要比較組合範式是否勝過純模組', '整理成報告 p3');
  task('T2', '困難檔淨增量', 'blocked', '等裁決 J1', 100, '三個種子的困難檔差距都在帶內', '確認困難檔到底有沒有淨增量', '等 J1 裁決是否止損');
  task('T3', '解析代價與模板消融', 'done', '完成', 100, '量完解析代價、比較了模板數量', '確認解析不會吃掉增益', '這件工作已經結束');

  const runs = ['python3 eval/run.py --arm combo --seeds 1,2', 'python3 eval/run.py --arm module --seeds 1,2', 'python3 eval/run.py --suite hard --seeds 1,2,3',
    'python3 eval/run.py --sampling pass@k --seeds 1,2', 'python3 eval/parse_bench.py', 'python3 train/ablate_templates.py'].map(cmd => recordRun(ck, cmd, { agent:A, capture:true }).run.id);
  const R = 'results/數據總表.json';
  const claim = (id, text, hypothesis, run, path, key) => w('claim_recorded', { claim:{ id, text, hypothesis, evidence:[{ run, path, key }] } });
  claim('C1', '組合臂準確率 91.25%，顯著勝過純模組', 'H-M01', runs[0], R, 'combo.acc');
  claim('C2', '純模組比裸底座高 28.8 個百分點', 'H-M00', runs[1], R, 'module_vs_base');
  claim('C3', '困難檔沒有淨增量（三個種子都在帶內）', 'H-D02', runs[2], R, 'hard.delta_by_seed');
  claim('C4', '換成 pass@k 取樣沒有改變結論', 'H-E01', runs[3], R, 'sampling.pass1');
  claim('C5', '解析端到端代價為 0', 'H-M00', runs[4], 'results/parse_bench.json', 'e2e_cost');
  claim('C6', '5 個模板優於單一模板', 'H-D03', runs[5], 'results/ablation.json', 'templates');

  const hyp = (id, label, status, one) => w('hypothesis_upserted', { hypothesis:{ id, label, status, one } });
  hyp('H-M01', '組合範式', 'verified', '模組加守衛示例勝過純模組');
  hyp('H-M00', '主路線錨點', 'verified', '小樣本訓練就能過判準線');
  hyp('H-D02', '困難檔資料擴充', 'open', '困難檔是否值得再擴資料');
  hyp('H-E01', '取樣口徑', 'verified', 'greedy 沒有低估模型');
  hyp('H-D03', '多模板配方', 'optimized', '5 個模板優於單一模板');

  w('premise_recorded', { premise:{ id:'PR1', text:'自動評分器和人工判斷一致（未校準）', used:'所有通過／失敗讀數', risk:'中', grounds:['eval/judge.py'] } });
  w('premise_recorded', { premise:{ id:'PR2', text:'合成任務的結論可以遷移到真實場景（未測）', used:'全部價值主張', risk:'高', grounds:[] } });
  w('decision_requested', { decision:{ id:'J1', question:'困難檔止損：接受「困難檔沒有淨增量」的負結果？', options:['採納', '駁回', '改'], rec:0,
    reason:'三個種子的差距都在帶內，再試只是換超參數。', grounds:['C3'], blocking:true, task:'T2' } });
  w('decision_requested', { decision:{ id:'J2', question:'組合範式定為主線？', options:['採納', '駁回', '改'], rec:0,
    reason:'組合臂顯著勝過純模組；風險是只測過單一格式。', grounds:['C1'], blocking:false } });
  w('node_created', { node:{ id:'N1', kind:'paper', title:'格式遵從的評測方法（示範文獻卡）', body:'評分器的比對規則會直接決定分數；寬鬆比對會讓格式錯誤也算對。' } });
  w('edge_created', { edge:{ from:'N1', to:'C1', kind:'cites', label:'評測口徑' } });
}
