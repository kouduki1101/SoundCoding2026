(async function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const stamp = sec => Math.floor(Math.max(0,sec)/60)+':'+String(Math.floor(Math.max(0,sec)%60)).padStart(2,'0');
  const names = {piano:'ピアノ',pluck:'ピッツィカート',strings:'弦楽器',bass:'ベース'};
  const palette = {piano:'#b0863d',pluck:'#458baa',strings:'#688d6e',bass:'#846b9e'};
  const player = new ScorePlayer({sampleBaseUrl:'./audio-assets/'});
  const json = async path => {const r=await fetch(path);if(!r.ok)throw Error('サンプルを読み込めませんでした。');return r.json();};
  const [bundle,examples] = await Promise.all([json('./story-fixtures.json'),json('./review-scenes.json')]);
  const scenes = [...examples.scenes,
    {id:'return-contract',title:'返す値と、受け取る側',request:'架空の予約担当・レン：「仮押さえ番号も返すようにしました。受け取る側を一緒に見てください。」',before:bundle.stages.base.files,after:bundle.stages.draft.files},
    {id:'return-followup',title:'レビュー後の受け取り方',request:'共有の checkout で、予約結果の ok を確かめる変更を加えました。',before:bundle.stages.draft.files,after:bundle.stages.aligned.files}];
  const state = {files:{},beforeFiles:null,model:null,beforeModel:null,score:null,comparison:null,sceneId:null,before:false,selection:null,file:null,line:null,position:0,playing:false,paused:false,queue:[],playId:0,active:[],full:false,range:null,hash:null,beforeHash:null,version:0,importMode:'new',notes:[],drafts:{},editingFile:null,lastPhase:null};
  try {state.notes=JSON.parse(localStorage.getItem('soundcoding-review-notes-v1')||'[]').filter(n=>n&&typeof n.text==='string').slice(-50);}catch{}
  const mdl = () => state.before?state.beforeModel:state.model;
  const scr = () => state.before?state.comparison?.before:state.score;
  const src = () => state.before?state.beforeFiles:state.files;
  const takeName = () => state.before?'変更前':state.beforeFiles?'変更後':'読み込んだコード';
  const selectedId = () => state.before?state.selection?.beforeId:state.selection?.afterId;
  const connection = () => state.selection?.kind==='relation'?mdl()?.connections.find(c=>c.id===selectedId()):null;
  const currentFn = () => {const c=connection();return mdl()?.functions.find(f=>f.id===(c?.source||selectedId()));};
  const profile = id => scr()?.profiles[id];
  const voiceColor = id => palette[profile(id)?.instrument]||'#688d6e';
  function say(message){$('status').textContent=message;}
  function sayOutcome(message){say(state.diagnostics?.length?'解析できない部分があります：'+state.diagnostics.join(' / '):message);}
  async function digest(files){const bytes=new TextEncoder().encode(JSON.stringify(Object.keys(files).sort().map(p=>[p,files[p]])));return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');}
  function evidence(){const hash=state.before?state.beforeHash:state.hash;return Object.values(bundle.stages).find(s=>s.sourceSha256===hash)?.verification||null;}
  function relationPair(id,before=state.before){return state.comparison?.relationPairs?.find(p=>(before?p.beforeId:p.afterId)===id);}
  function functionPair(id,before=state.before){return state.comparison?.functionPairs?.find(p=>(before?p.beforeId:p.afterId)===id);}
  function sectionFor(before=state.before){
    const score=before?state.comparison?.before:state.score,id=before?state.selection?.beforeId:state.selection?.afterId;
    if(!score||!id)return null;
    return score.sections.find(s=>s.id===(state.selection.kind==='relation'?'relation:':'voice:')+id)||null;
  }
  function playablePair(){return !!state.beforeModel&&!!sectionFor(true)&&!!sectionFor(false);}
  function selectionRange(){
    const s=sectionFor();if(!s)return {start:0,end:scr()?.durationSec||0};
    const blockId=state.before?state.selection?.beforeBlock:state.selection?.afterBlock;
    const events=blockId?scr().events.filter(e=>e.sectionId===s.id&&(e.blockId===blockId||e.source?.blockId===blockId)):[];
    return events.length?{start:Math.min(...events.map(e=>e.at)),end:Math.min(s.end,Math.max(...events.map(e=>e.at+e.duration))+.3)}:{start:s.at,end:s.end};
  }
  function pause(cancel=true){
    state.playId++;state.playing=false;player.stop();state.paused=true;
    if(cancel)state.queue=[];
    updateTransport();
  }
  function resetPlayback(){pause();state.paused=false;state.active=[];state.full=false;state.pairMode=false;state.lastPhase=null;state.range=null;state.failureEnd=null;$('investigation').hidden=true;}
  function setConnection(id,{before=state.before,keepFile=false}={}){
    const model=before?state.beforeModel:state.model,c=model?.connections.find(x=>x.id===id);if(!c)return false;
    const p=relationPair(id,before);
    state.selection={kind:'relation',beforeId:p?p.beforeId:(state.beforeModel?.connections.some(x=>x.id===id)?id:null),afterId:p?p.afterId:(state.model.connections.some(x=>x.id===id)?id:null),key:p?.key||id};
    state.before=before;state.line=(c.callSource||c.sourceLocation).startLine;
    if(!keepFile)state.file=(c.callSource||c.sourceLocation).file;
    state.range=selectionRange();state.position=state.range.start;return true;
  }
  function setFunction(id,{block=null,before=state.before}={}){
    const model=before?state.beforeModel:state.model,fn=model?.functions.find(f=>f.id===id);if(!fn)return;
    const p=functionPair(id,before),oldId=p?p.beforeId:(state.beforeModel?.functions.some(f=>f.id===id)?id:null),newId=p?p.afterId:(state.model.functions.some(f=>f.id===id)?id:null);
    state.selection={kind:'function',beforeId:oldId,afterId:newId};state.before=before;state.file=fn.file;state.line=block?.source.startLine||fn.source.startLine;
    if(block){
      const oldFn=state.beforeModel?.functions.find(f=>f.id===oldId),newFn=state.model.functions.find(f=>f.id===newId);
      const oldBlock=oldFn?.blocks?.filter(b=>b.fingerprint===block.fingerprint),newBlock=newFn?.blocks?.filter(b=>b.fingerprint===block.fingerprint);
      // Ambiguous or changed blocks fall back to the corresponding whole function.
      if(!state.beforeModel || oldBlock?.length===1&&newBlock?.length===1){state.selection.beforeBlock=oldBlock?.[0]?.id;state.selection.afterBlock=newBlock?.[0]?.id;}
    }
    state.range=selectionRange();state.position=state.range.start;
  }
  function syntax(line){return line.split(/(\/\/.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:import|from|export|function|return|const|let|if|else|for|of|new|throw|async|await|true|false|null)\b|\b\d+(?:\.\d+)?\b)/g).map(t=>{const cls=t.startsWith('//')?'comment':/^['"]/.test(t)?'str':/^(import|from|export|function|return|const|let|if|else|for|of|new|throw|async|await|true|false|null)$/.test(t)?'kw':/^\d/.test(t)?'number':'';return cls?'<span class="'+cls+'">'+esc(t)+'</span>':esc(t);}).join('');}
  function lineHTML(line,n,path,changed=false){return '<button class="code-line '+(changed?'changed ':'')+(path===state.file&&n===state.line?'selected':'')+'" data-line="'+n+'" data-source-file="'+esc(path)+'" aria-label="'+n+'行目 '+esc(line)+'"><span class="line-no">'+n+'</span><span class="line-text">'+(syntax(line)||' ')+'</span></button>';}
  function sourceLink(s,label='コードを見る'){return s?'<button class="source-link" data-jump-file="'+esc(s.file)+'" data-jump-line="'+s.startLine+'">'+esc(label)+' '+esc(s.file)+':'+s.startLine+'</button>':'';}
  function renderFiles(){
    $('files').innerHTML=Object.keys(src()||{}).sort().map(p=>'<button class="file '+(p===state.file?'active':'')+'" data-file="'+esc(p)+'">'+esc(p.split('/').at(-1))+(state.beforeFiles&&state.beforeFiles[p]!==state.files[p]?'<i class="change-dot" title="変更のあるファイル"></i>':'')+'</button>').join('');
  }
  function closeEditor(){if(state.editingFile)state.drafts[state.editingFile]=$('editor').value;state.editingFile=null;$('editor-panel').hidden=true;$('code').hidden=false;}
  function renderCode(){
    if(!Object.hasOwn(src()||{},state.file))state.file=Object.keys(src()||{}).sort()[0];
    const text=src()?.[state.file]||'';
    $('file-name').textContent=state.file||'コードファイルを開いてください';$('source-label').textContent=takeName();$('edit-toggle').disabled=state.before||!state.file;
    const changed=state.beforeFiles&&!state.before?StoryAnalyzer.changedLines(state.beforeFiles[state.file]||'',text):new Set();
    $('code').innerHTML=text.split('\n').map((line,i)=>lineHTML(line,i+1,state.file,changed.has(i+1))).join('');
    renderFiles();renderContext();
  }
  function renderContext(){
    const fn=currentFn(),c=connection(),location=state.file?(state.file+':'+(state.line||fn?.source.startLine||1)):'';
    $('source-location').textContent=c?c.callerName+' → '+c.calleeName:fn?fn.name+' · 行 '+(state.line||fn.source.startLine):'行を選ぶと、その部分を聴けます。';
    $('note-context').textContent=takeName()+' / '+location+(c?' / '+c.callerName+' → '+c.calleeName:'');$('listen-selection').disabled=!fn;
  }
  function chip(id){const f=mdl().functions.find(f=>f.id===id),p=profile(id);if(!f||!p)return '';return '<button class="voice-chip" data-voice="'+esc(id)+'" style="--voice:'+voiceColor(id)+'" title="'+esc(f.name)+'の声だけ聴く"><i></i><b>'+esc(f.name)+'</b><small>'+names[p.instrument]+'</small><span class="mini-notes" aria-hidden="true">'+p.notes.map(n=>'<i style="--note-y:'+(-(n-p.rootMidi-4)*.6)+'px"></i>').join('')+'</span></button>';}
  function renderHandoff(){const c=connection(),fn=currentFn();$('handoff').innerHTML=c?chip(c.source)+'<span class="handoff-arrow" aria-hidden="true">⇄</span>'+chip(c.target)+'<span class="handoff-explain">相手の主題を呼び、同じ主題で応える。</span>':fn?chip(fn.id)+'<span class="handoff-explain">同じ声の中で、ブロックごとの節回しを聴く。</span>':'<span class="empty">解析できる関数を選んでください。</span>';}
  function renderPartner(anchor=null){
    const c=connection(),fn=c?mdl().functions.find(f=>f.id===c.target):null;
    $('investigate').disabled=!c;
    if(!fn){$('partner-title').textContent='つながる相手を選ぶ';$('partner-code').innerHTML='<p class="empty">下の接点を選ぶと、相手のコードをここに表示します。関数の声だけ聴くこともできます。</p>';$('relation-observation').textContent='';return;}
    $('partner-title').textContent=fn.name;
    const span=anchor?.file===fn.file?anchor:fn.source,all=(src()[fn.file]||'').split('\n');
    const start=fn.source.endLine-fn.source.startLine<10?fn.source.startLine:Math.max(fn.source.startLine,span.startLine-1),end=Math.min(fn.source.endLine,Math.max(start+7,Math.min(span.endLine,start+12)));
    $('partner-code').innerHTML='<div class="snippet-path"><span>'+esc(fn.file)+' · '+names[profile(fn.id)?.instrument]+'</span>'+sourceLink(fn.source,'開く')+'</div>'+all.slice(start-1,end).map((line,i)=>lineHTML(line,start+i,fn.file)).join('');
    $('partner-code').dataset.file=fn.file;
    $('relation-observation').innerHTML='<strong>'+esc(c.callerName)+'</strong> が <strong>'+esc(c.calleeName)+'</strong> を呼んでいます。'+(c.resolution==='default-argument'?'<p class="muted">引数を省略した場合の接続です。</p>':'')+'<p class="muted">呼び出す行と、相手が返す値を読み合わせる接点です。</p>';
  }
  function renderConnections(){
    const fn=currentFn(),cs=mdl()?.connections.filter(c=>c.source===fn?.id||c.target===fn?.id)||[];
    $('connections').innerHTML=cs.length?cs.map(c=>'<button class="connection '+(c.id===selectedId()?'active':'')+'" data-connection="'+esc(c.id)+'"><span>'+esc(c.callerName)+' → '+esc(c.calleeName)+'</span><small>聴く ↗</small></button>').join(''):'<span class="muted">この関数について解決した呼び出しはありません。</span>';
    const ds=mdl()?.diagnostics||[],unresolved=ds.filter(d=>/unresolved|unsupported|external/.test(d.kind||'')).length;
    $('coverage').textContent=mdl()?.connections.length+'接点を解析'+(unresolved?' · 未解決等 '+unresolved+'件':' · 静的な関係');
  }
  function renderLiner(){
    const fn=currentFn(),c=connection(),pair=c?relationPair(c.id):null,fp=fn?functionPair(fn.id):null;
    const review=StoryCritique.review(mdl(),fn?.id,c?.id,{previousModel:state.before?null:state.beforeModel,previousConnectionId:pair?.beforeId,previousFunctionId:fp?.beforeId});
    $('critique-title').textContent=review.heading;
    $('liner').textContent=review.prose;
    $('critique-relation').textContent=review.relationship;
    $('critique-question').textContent=review.question;$('critique-question').hidden=!review.question;
    $('mapping-summary').textContent=review.musicalMetaphor;
    $('critique-limit').textContent=review.soundStatus;$('critique-limit').hidden=!review.soundStatus;
    $('mapping-open').hidden=!review.sources.length;
    const shown=new Set();$('mapping-detail').innerHTML=review.sources.filter(({source:s})=>{const key=s.file+':'+s.startLine+':'+s.endLine;if(shown.has(key))return false;shown.add(key);return true;}).map(({label,source:s})=>{const lines=(src()?.[s.file]||'').split('\n'),end=Math.min(s.endLine,s.startLine+3);return '<div class="critique-source"><b>'+esc(label)+'</b>'+sourceLink(s,'該当するコード')+'<pre>'+esc(lines.slice(s.startLine-1,end).map((line,i)=>(s.startLine+i)+'  '+line).join('\n'))+(s.endLine>end?'\n…':'')+'</pre></div>';}).join('');
  }
  function renderEvidence(){
    const e=evidence();$('evidence-summary').textContent=e?'保存記録 '+e.passed+'/'+e.testCount+'件成功':'このコードは未実行';
    if(!e){$('evidence-detail').innerHTML='<p>この版に一致する実行記録はありません。入力コードはブラウザ内で静的に解析しています。テストは実行していません。</p>';return;}
    $('evidence-detail').innerHTML='<p>表示中のソースのSHA-256と一致する、Node.jsで実行した保存記録です。</p>'+e.cases.filter(c=>c.status==='failed'||c.source?.file===state.file).slice(0,6).map(c=>'<div class="test-row '+(c.status==='failed'?'failed':'')+'"><strong>'+(c.status==='failed'?'× ':'✓ ')+esc(c.title)+'</strong>'+(c.status==='failed'?'<pre>期待 '+esc(JSON.stringify(c.expected))+'\n実際 '+esc(JSON.stringify(c.actual))+'</pre>':'')+'</div>').join('')+(e.failed?'<button id="listen-failure" class="plain">このテストの失敗を、中断として聴く</button><p>保存記録の失敗を表す演出です。実行時刻やクラッシュした行を再現するものではありません。</p>':'<p>ここに含まれる入力についての結果です。演奏の完走はテスト成功を意味しません。</p>');
  }
  function renderAll(){renderCode();renderHandoff();renderPartner();renderConnections();renderLiner();renderEvidence();updateTransport();if(!state.playing&&!state.paused){$('phase-badge').textContent=connection()?'この接点':'この関数';$('now-playing').textContent=!sectionFor()?'演奏する関数の行を選んでください。':playablePair()?'同じ'+(connection()?'接点':'関数')+'を、変更前から変更後へ。':'選んだ'+(connection()?'接点':'関数')+'を聴けます。';}paint(state.position,[]);}
  function updateTransport(){
    const r=state.range||selectionRange(),pair=playablePair();
    $('play').disabled=!mdl()?.functions.length||!sectionFor();$('play-symbol').textContent=state.playing?'Ⅱ':'▶';
    $('replay').disabled=!sectionFor();$('seek').disabled=!sectionFor()&&!state.full;
    $('play-label').textContent=state.playing?'一時停止':state.paused?'ここから続ける':pair?'前 → 後を聴く':'この部分を聴く';
    $('take-before').disabled=!sectionFor(true);$('take-after').disabled=!sectionFor(false);$('take-before').setAttribute('aria-pressed',String(state.before));$('take-after').setAttribute('aria-pressed',String(!state.before));
    $('take-after').textContent=state.beforeFiles?'変更後':'現在';$('clock').textContent=stamp(state.position-r.start);$('duration').textContent=stamp(r.end-r.start);
    $('seek').max=Math.max(.1,r.end-r.start);$('seek').value=Math.max(0,state.position-r.start);
    $('listen-all').disabled=!mdl()?.functions.length;
  }
  function eventRange(e){if(!e?.source)return null;const s=e.source;if(s.kind==='connection')return s.active||((e.phase||s.phase)==='reception'?(s.use||s.caller):(s[s.activeSide]||((e.phase||s.phase)==='callee'?s.callee:s.caller)));return s;}
  function paint(seconds,active=[]){
    state.position=seconds;if(active.length)state.active=active;
    const r=state.range||selectionRange();$('clock').textContent=stamp(seconds-r.start);$('seek').value=Math.max(0,seconds-r.start);
    const lead=active.find(e=>e.connectionId)||active[0],phase=lead?.phase||lead?.source?.phase;
    if(state.full&&lead&&$('follow').checked){
      const next=lead.connectionId?{kind:'relation',id:lead.connectionId}:{kind:'function',id:lead.part};
      if(next.kind!==state.selection?.kind||next.id!==selectedId()){
        const pos=state.position,range=state.range;
        if(next.kind==='relation')setConnection(next.id);else setFunction(next.id);
        state.position=pos;state.range=range;renderCode();renderHandoff();renderPartner();renderConnections();renderLiner();
      }
    }
    if(!lead)return;
    const phaseKey=(lead.connectionId||lead.blockId||lead.part)+':'+phase+':'+eventRange(lead)?.startLine;
    if(phaseKey!==state.lastPhase){
      state.lastPhase=phaseKey;
      const c=connection();if(c&&phase==='callee')renderPartner(eventRange(lead));
      const range=eventRange(lead);
      if($('follow').checked&&range?.file===state.file){const line=$('code').querySelector('[data-line="'+range.startLine+'"]');if(line)$('code').scrollTop=Math.max(0,line.offsetTop-$('code').offsetTop-55);}
    }
    const ranges=active.map(e=>({range:eventRange(e),part:e.part})).filter(e=>e.range);
    document.querySelectorAll('#code .code-line,#partner-code .code-line').forEach(line=>{const n=Number(line.dataset.line),a=ranges.find(e=>e.range.file===line.dataset.sourceFile&&n>=e.range.startLine&&n<=e.range.endLine);line.classList.toggle('sounding',!!a);if(a)line.style.setProperty('--voice',voiceColor(a.part));});
    document.querySelectorAll('[data-voice]').forEach(el=>el.classList.toggle('active',active.some(e=>e.part===el.dataset.voice)));
    const c=connection(),phrases={caller:'相手の主題を呼ぶ',callee:'同じ主題で応える',reception:'呼ぶ側へ受け渡す',context:'二つの声を重ねる'};
    $('phase-badge').textContent=phrases[phase]||'ブロックのフレーズ';
    $('now-playing').textContent=takeName()+' · '+(c?c.callerName+' ⇄ '+c.calleeName:currentFn()?.name||'')+' · '+(phrases[phase]||'音の根拠を表示');
  }
  function switchTake(before,{preserveOffset=false}={}){
    if(before&&!state.beforeModel)return;
    if(!sectionFor(before)){say('この接点・関数の前後対応を確定できません。別の接点を選ぶか、この版だけを聴いてください。');return false;}
    closeEditor();const oldRange=state.range||selectionRange(),offset=preserveOffset?state.position-oldRange.start:0;state.before=before;
    const id=selectedId();
    const fn=currentFn();if(fn){state.file=fn.file;state.line=connection()?.callSource?.startLine||fn.source.startLine;}
    state.range=selectionRange();state.position=Math.min(state.range.end,state.range.start+offset);state.lastPhase=null;state.active=[];state.failureEnd=null;renderAll();return true;
  }
  async function playCurrent({failure=false}={}){
    if(!mdl()?.functions.length||!state.full&&!sectionFor())return;
    const id=++state.playId;state.playing=true;state.paused=false;state.lastPhase=null;updateTransport();
    const r=state.range||selectionRange();if(state.position<r.start||state.position>=r.end-.05)state.position=r.start;
    if(failure)state.failureEnd=r.start+(r.end-r.start)*.72;
    const end=state.failureEnd??r.end;
    if(state.position>=end-.05)state.position=r.start;
    const section=sectionFor(),events=scr().events.filter(e=>state.full||!section||e.sectionId===section.id).map(e=>({...e,notes:[e.midi],velocity:e.gain,pan:0}));
    try{await player.play(events,{startSec:state.position,duration:end,volume:Number($('volume').value),onTick:(sec,last,active)=>{if(id===state.playId)paint(sec,active);},onEnd:()=>{
      if(id!==state.playId)return;state.playing=false;state.paused=false;
      if(state.failureEnd!=null){state.failureEnd=null;state.queue=[];$('evidence-detail').hidden=false;say('保存済みテストの失敗を表すため、ここで演奏を中断しました。テストの入力と結果を確認してください。');updateTransport();return;}
      if(state.queue.length){const next=state.queue.shift();switchTake(next);playCurrent();return;}
      if($('loop').checked){if(state.full){state.position=r.start;playCurrent();return;}if(state.pairMode&&playablePair()){state.queue=[false];switchTake(true);}else state.position=r.start;playCurrent();return;}
      $('now-playing').textContent=takeName()+' · 同じやり取りを、もう一度聴けます。';updateTransport();
    }});}catch(error){if(id!==state.playId)return;state.playing=false;state.paused=false;state.queue=[];say(error.message);updateTransport();}
  }
  function startAudition({pair=true,failure=false}={}){
    pause();state.paused=false;state.full=false;state.pairMode=pair&&playablePair();state.active=[];state.failureEnd=null;
    if(pair&&playablePair()){state.queue=[false];switchTake(true);}else{state.queue=[];state.range=selectionRange();state.position=state.range.start;}
    $('follow').checked=true;playCurrent({failure});
  }
  async function apply(files,{before=null,sceneId='custom',preferred=null}={}){
    resetPlayback();closeEditor();state.version++;const version=state.version;
    state.files={...files};state.beforeFiles=before?{...before}:null;state.before=false;state.sceneId=sceneId;state.drafts={};state.hash=null;state.beforeHash=null;state.selection=null;
    state.model=StoryAnalyzer.analyze(state.files);state.beforeModel=before?StoryAnalyzer.analyze(before):null;state.comparison=state.beforeModel?StoryScore.buildComparison(state.beforeModel,state.model,{bpm:100}):null;state.score=state.comparison?.after||StoryScore.buildScore(state.model,{bpm:100});
    const pairs=state.comparison?.relationPairs||[];
    const changed=pairs.find(p=>{const a=state.beforeModel.connections.find(c=>c.id===p.beforeId),b=state.model.connections.find(c=>c.id===p.afterId);return a&&b&&a.target!==b.target;});
    const changedUse=pairs.find(p=>{const a=state.beforeModel.connections.find(c=>c.id===p.beforeId),b=state.model.connections.find(c=>c.id===p.afterId);return a&&b&&JSON.stringify([a.providedShape,a.usageKind,a.projection])!==JSON.stringify([b.providedShape,b.usageKind,b.projection]);});
    const changedFn=state.model.functions.find(f=>{const old=state.beforeModel?.functions.find(o=>o.id===f.id);return old&&old.fingerprint!==f.fingerprint;});
    const c=state.model.connections.find(c=>c.id===preferred?.connectionId)||state.model.connections.find(c=>c.id===(changed||changedUse)?.afterId);
    if(c)setConnection(c.id,{before:false});else if(changedFn)setFunction(changedFn.id,{before:false});else if(state.model.connections.length)setConnection(state.model.connections[0].id,{before:false});else if(state.model.functions.length)setFunction(state.model.functions[0].id,{before:false});else{state.file=Object.keys(files)[0];state.line=null;state.range={start:0,end:0};state.position=0;}
    const scene=scenes.find(s=>s.id===sceneId);$('review-request').textContent=scene?.request||'手元のコードを開きました。関数や接点を選んで、つながりを聴けます。';$('scope-badge').textContent=Object.keys(files).length+' FILES · '+state.model.functions.length+' VOICES';
    $('scene-select').value=sceneId;$('import-revision').disabled=false;document.querySelector('.topbar').classList.toggle('custom',sceneId==='custom');$('investigation').hidden=true;$('evidence-detail').hidden=true;$('evidence-open').setAttribute('aria-expanded','false');
    renderAll();$('follow').checked=true;
    const ds=state.model.diagnostics.filter(d=>d.severity==='error'||['limit','unsupported-syntax'].includes(d.kind));state.diagnostics=ds.map(d=>d.message);sayOutcome('');
    try{const [hash,oldHash]=await Promise.all([digest(state.files),before?digest(before):null]);if(version!==state.version)return;state.hash=hash;state.beforeHash=oldHash;renderEvidence();}catch{say('ソースの版を照合できないため、テスト記録は表示しません。');}
  }
  async function openScene(id){const scene=scenes.find(s=>s.id===id);if(scene)await apply(scene.after,{before:scene.before,sceneId:id});}
  function jump(file,line){
    resetPlayback();closeEditor();state.file=file;state.line=line;
    const fn=mdl().functions.find(f=>f.file===file&&f.source.startLine<=line&&f.source.endLine>=line);
    if(fn){const c=mdl().connections.find(c=>c.source===fn.id&&[c.callSource,c.useSource].some(s=>s&&line>=s.startLine&&line<=s.endLine));if(c)setConnection(c.id);else setFunction(fn.id,{block:fn.blocks?.find(b=>line>=b.source.startLine&&line<=b.source.endLine)});}
    else{state.selection=null;state.range={start:0,end:0};state.position=0;sayOutcome('この行には、演奏できる関数やブロックがありません。関数の行を選んでください。');}
    state.file=file;state.line=line;renderAll();$('follow').checked=false;
    const el=$('code').querySelector('[data-line="'+line+'"]');if(el)$('code').scrollTop=Math.max(0,el.offsetTop-$('code').offsetTop-55);
  }
  function download(name,value,type='application/json'){const url=URL.createObjectURL(new Blob([value],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function renderNotes(){$('notes').innerHTML=state.notes.map(n=>'<article class="review-note"><small>'+esc(n.context)+' · '+esc(n.hash?.slice(0,12)||'未照合')+'</small>'+esc(n.text)+'</article>').join('');}
  $('play').onclick=()=>{if(state.playing){pause(false);return;}if(state.paused){playCurrent();return;}startAudition();};
  $('replay').onclick=()=>startAudition();
  $('take-before').onclick=()=>{pause();state.paused=false;state.full=false;state.pairMode=false;if(switchTake(true))playCurrent();};
  $('take-after').onclick=()=>{pause();state.paused=false;state.full=false;state.pairMode=false;if(switchTake(false))playCurrent();};
  $('seek').oninput=()=>{const was=state.playing,value=Number($('seek').value);pause(false);const r=state.range||selectionRange();state.position=Math.min(state.failureEnd??r.end,r.start+value);state.active=[];paint(state.position,[]);if(was)playCurrent();};
  $('volume').oninput=()=>player.setVolume(Number($('volume').value));$('follow').onchange=()=>state.lastPhase=null;
  $('listen-all').onclick=()=>{pause();state.paused=false;state.failureEnd=null;state.full=true;state.pairMode=false;state.range={start:0,end:scr().durationSec};state.position=0;$('follow').checked=true;playCurrent();};
  $('scene-select').onchange=e=>{if(e.target.value!=='custom')openScene(e.target.value);};
  $('connections').onclick=e=>{const b=e.target.closest('[data-connection]');if(b){resetPlayback();closeEditor();setConnection(b.dataset.connection);renderAll();startAudition();}};
  $('handoff').onclick=e=>{const b=e.target.closest('[data-voice]');if(b){resetPlayback();closeEditor();setFunction(b.dataset.voice);renderAll();startAudition({pair:false});}};
  $('files').onclick=e=>{const b=e.target.closest('[data-file]');if(!b)return;const fn=mdl().functions.find(f=>f.file===b.dataset.file);jump(b.dataset.file,fn?.source.startLine||1);};
  $('code').onclick=e=>{const b=e.target.closest('[data-line]');if(b)jump(b.dataset.sourceFile,Number(b.dataset.line));};
  $('partner-code').onclick=e=>{const b=e.target.closest('[data-jump-file],[data-line]');if(b){jump(b.dataset.jumpFile||b.dataset.sourceFile,Number(b.dataset.jumpLine||b.dataset.line));$('code').scrollIntoView({block:'center'});}};
  $('code').addEventListener('wheel',()=>{$('follow').checked=false;},{passive:true});$('code').addEventListener('touchmove',()=>{$('follow').checked=false;},{passive:true});
  $('code').addEventListener('keydown',e=>{if(['ArrowDown','ArrowUp','PageDown','PageUp','Home','End'].includes(e.key))$('follow').checked=false;});
  $('listen-selection').onclick=()=>startAudition();
  $('investigate').onclick=()=>{
    const c=connection();if(!c)return;pause();state.paused=false;
    const report=StoryAnalyzer.investigate(mdl(),c.id);
    $('investigation').hidden=false;$('investigation').innerHTML='<p class="tiny-label">コードから確認できること</p>'+report.facts.map(f=>'<div class="fact"><p>'+esc(f.text)+'</p>'+sourceLink(f.source)+'</div>').join('')+'<p class="question">'+esc(report.question)+'</p>'+report.unknowns.map(x=>'<p class="muted">'+esc(x)+'</p>').join('')+'<p class="muted">ブラウザ内の静的な観察です。AIによる調査やテスト実行ではありません。</p>';updateTransport();
  };
  $('investigation').onclick=e=>{const b=e.target.closest('[data-jump-file]');if(b){jump(b.dataset.jumpFile,Number(b.dataset.jumpLine));$('code').scrollIntoView({block:'center'});}};
  $('mapping-open').onclick=()=>{$('mapping-detail').hidden=!$('mapping-detail').hidden;$('mapping-open').setAttribute('aria-expanded',String(!$('mapping-detail').hidden));};
  $('mapping-detail').onclick=e=>{const b=e.target.closest('[data-jump-file]');if(b){jump(b.dataset.jumpFile,Number(b.dataset.jumpLine));$('code').scrollIntoView({block:'center'});}};
  $('evidence-open').onclick=()=>{$('evidence-detail').hidden=!$('evidence-detail').hidden;$('evidence-open').setAttribute('aria-expanded',String(!$('evidence-detail').hidden));};
  $('evidence-detail').onclick=e=>{if(e.target.id!=='listen-failure'||!evidence()?.failed)return;const c=mdl().connections.find(c=>c.calleeName==='reserve');if(c){resetPlayback();setConnection(c.id);renderAll();startAudition({pair:false,failure:true});}};
  $('edit-toggle').onclick=()=>{pause();state.paused=false;state.editingFile=state.file;$('editor').value=state.drafts[state.file]??state.files[state.file];$('editor-panel').hidden=false;$('code').hidden=true;$('follow').checked=false;$('editor').focus();updateTransport();};
  $('cancel-edit').onclick=closeEditor;
  $('reanalyze').onclick=async()=>{const file=state.editingFile||state.file,text=$('editor').value;if(text.length>150000){say('1ファイルは150,000文字以内にしてください。');return;}const next={...state.files,[file]:text},old={...state.files},drafts={...state.drafts};delete drafts[file];await apply(next,{before:old});state.drafts=drafts;const fn=state.model.functions.find(f=>f.file===file);if(!fn)jump(file,1);else if(state.file!==file){setFunction(fn.id,{before:false});renderAll();}sayOutcome('編集したコードから演奏を組み直しました。同じ部分を変更前後で聴き比べられます。');};
  $('import-revision').onclick=()=>{state.importMode='revision';$('file-input').click();};
  $('file-input').addEventListener('cancel',()=>state.importMode='new');
  $('file-input').onchange=async e=>{
    const selected=[...e.target.files];if(!selected.length)return;
    try{
      if(selected.length>24||selected.reduce((s,f)=>s+f.size,0)>1200000)throw Error('24ファイル・合計1.2 MB以内の変更セットを選んでください。');
      const files={};
      if(selected.length===1&&selected[0].name.endsWith('.json')){const value=JSON.parse(await selected[0].text());if(value.format!=='soundcoding-source/1'||!value.files||typeof value.files!=='object'||Array.isArray(value.files))throw Error('SoundCodingの変更セットJSONを選んでください。');for(const [p,t] of Object.entries(value.files)){if(!/^[\w./ -]+\.(?:m?js|cjs)$/.test(p)||p.split('/').includes('..')||typeof t!=='string')throw Error('変更セットのファイル名または内容が不正です。');files[p]=t;}}
      else for(const file of selected){if(!/\.(m?js|cjs)$/.test(file.name))throw Error('現在はJavaScriptファイルに対応しています。');const p=file.webkitRelativePath||file.name;if(Object.hasOwn(files,p))throw Error('同名ファイルがあります。パスを含む変更セットJSONで開いてください。');files[p]=await file.text();}
      if(!Object.keys(files).length)throw Error('JavaScriptファイルがありません。');
      if(Object.keys(files).length>24||Object.values(files).reduce((s,t)=>s+t.length,0)>300000||Object.values(files).some(t=>t.length>150000))throw Error('解析範囲は24ファイル・合計300,000文字・1ファイル150,000文字までです。');
      const revision=state.importMode==='revision';await apply(files,{before:revision?state.files:null});sayOutcome(revision?'変更後の一式を読み込みました。同じ接点を前後で聴き比べられます。':'コードをブラウザ内で開きました。修正版は「変更後を開く」から読み込めます。コードは実行・送信していません。');
    }catch(error){say(error.message);}finally{e.target.value='';state.importMode='new';}
  };
  $('reset-sample').onclick=()=>openScene(scenes[0].id);
  $('download-code').onclick=()=>download('soundcoding-'+state.sceneId+'.json',JSON.stringify({format:'soundcoding-source/1',files:src()},null,2));
  $('note-open').onclick=()=>{$('review-panel').hidden=false;renderContext();$('review-panel').scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});$('note').focus({preventScroll:true});};
  $('note-close').onclick=()=>$('review-panel').hidden=true;
  $('save-note').onclick=()=>{const text=$('note').value.trim();if(!text){say('気づいたことを入力してください。');return;}state.notes.push({text:text.slice(0,5000),context:$('note-context').textContent,sceneId:state.sceneId,file:state.file,line:state.line,selection:state.selection,position:state.position,hash:state.before?state.beforeHash:state.hash,createdAt:new Date().toISOString()});state.notes=state.notes.slice(-50);try{localStorage.setItem('soundcoding-review-notes-v1',JSON.stringify(state.notes));say('メモをこのブラウザに保存しました。コード本文は保存していません。');}catch{say('端末に保存できませんでした。メモを書き出してください。');}$('note').value='';renderNotes();};
  $('export-notes').onclick=()=>download('soundcoding-review.md','# SoundCoding レビュー\n\n'+state.notes.map(n=>n.context+'\n\n'+n.text+'\n\nソース SHA-256: '+(n.hash||'未照合')).join('\n\n'),'text/markdown');
  $('help-open').onclick=()=>$('help').showModal();$('help-close').onclick=()=>$('help').close();document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});window.addEventListener('pagehide',()=>pause());
  $('scene-select').innerHTML=scenes.map((s,i)=>'<option value="'+esc(s.id)+'">'+String(i+1).padStart(2,'0')+' · '+esc(s.title)+'</option>').join('')+'<option value="custom" disabled>手元のコード</option>';
  renderNotes();await openScene(scenes[0].id);$('app').removeAttribute('inert');$('app').setAttribute('aria-busy','false');$('file-input').disabled=false;$('help-open').disabled=false;
})().catch(error=>{const el=document.getElementById('status');if(el)el.textContent='開始できませんでした：'+error.message;console.error(error);});
