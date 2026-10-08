/* ============================ チャート ============================ */
function sparkline(points,color){
  var nn=points.map(function(p){return p.value;}).filter(function(v){return v!=null;});
  if(!nn.length) return '<svg class="chart" width="100%" height="44"></svg>';
  var min=Math.min.apply(null,nn), max=Math.max.apply(null,nn);
  var W=100,H=44,pad=4; if(max===min)max=min+1;
  var n=points.length, pts=[];
  points.forEach(function(p,i){
    if(p.value==null) return;
    var x=n<=1?W/2:pad+(W-2*pad)*i/(n-1), y=H-pad-(H-2*pad)*(p.value-min)/(max-min);
    pts.push(x.toFixed(1)+","+y.toFixed(1));
  });
  return '<svg class="chart" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" width="100%" height="44"><polyline fill="none" stroke="'+color+'" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" points="'+pts.join(" ")+'"/></svg>';
}
function lineChart(points,benchmark,benchLabel,color){
  color=color||"var(--c1)";
  var vals=points.map(function(p){return p.value;}).filter(function(v){return v!=null;});
  if(benchmark!=null) vals.push(benchmark);
  if(!vals.length) return '<p class="muted fs13" style="text-align:center;padding:32px 0">データが不足しています。</p>';
  var top=Math.max.apply(null,vals)*1.25||0.01; if(top<=0)top=0.01;
  var W=560,H=240,L=44,R=16,T=12,B=28, iw=W-L-R, ih=H-T-B, n=points.length;
  function X(i){ return n<=1?L+iw/2:L+iw*i/(n-1); }
  function Y(v){ return T+ih*(1-v/top); }
  var grid=""; for(var g=0;g<=4;g++){ var v=top*g/4,y=Y(v);
    grid+='<line x1="'+L+'" y1="'+y.toFixed(1)+'" x2="'+(W-R)+'" y2="'+y.toFixed(1)+'" stroke="var(--border)" stroke-dasharray="3 3"/>';
    grid+='<text x="'+(L-6)+'" y="'+(y+3).toFixed(1)+'" text-anchor="end">'+Math.round(v*100)+'%</text>'; }
  var xlab=""; points.forEach(function(p,i){ xlab+='<text x="'+X(i).toFixed(1)+'" y="'+(H-8)+'" text-anchor="middle">'+esc(p.label)+'</text>'; });
  var line="",dots="",prev=null;
  points.forEach(function(p,i){
    if(p.value==null){prev=null;return;}
    var x=X(i),y=Y(p.value);
    if(prev) line+='<line x1="'+prev.x.toFixed(1)+'" y1="'+prev.y.toFixed(1)+'" x2="'+x.toFixed(1)+'" y2="'+y.toFixed(1)+'" stroke="'+color+'" stroke-width="2.5" stroke-linecap="round"/>';
    dots+='<circle cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="3.2" fill="'+color+'"><title>'+esc(p.label)+'：'+pct(p.value)+'</title></circle>';
    prev={x:x,y:y};
  });
  var bench="";
  if(benchmark!=null){ var by=Y(benchmark);
    bench='<line x1="'+L+'" y1="'+by.toFixed(1)+'" x2="'+(W-R)+'" y2="'+by.toFixed(1)+'" stroke="var(--warn)" stroke-width="1.5" stroke-dasharray="5 4"/>'+
      '<text x="'+(W-R)+'" y="'+(by-4).toFixed(1)+'" text-anchor="end" style="fill:var(--warn)">'+esc(benchLabel||"目安")+'</text>'; }
  return '<div class="twrap"><svg class="chart" viewBox="0 0 '+W+' '+H+'" width="100%" style="min-width:480px;height:auto">'+grid+xlab+bench+line+dots+'</svg></div>';
}

