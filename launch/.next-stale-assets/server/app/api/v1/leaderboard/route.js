(()=>{var a={};a.id=3881,a.ids=[3881],a.modules={261:a=>{"use strict";a.exports=require("next/dist/shared/lib/router/utils/app-paths")},3295:a=>{"use strict";a.exports=require("next/dist/server/app-render/after-task-async-storage.external.js")},7469:(a,b,c)=>{"use strict";c.d(b,{S:()=>d});class d extends Error{constructor(a,b={}){super(a),this.metadata=b,this.name="PublicApiError"}}},10846:a=>{"use strict";a.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},11139:(a,b,c)=>{"use strict";c.d(b,{$6:()=>d,Uh:()=>g,VQ:()=>h,WW:()=>e,_o:()=>j,sO:()=>f,uo:()=>i});let d={slug:"genesis",name:"Genesis Competition"},e={launchIntervalDays:4,minFollowers:100,minAccountAgeDays:30,minAssets:2,minAssetWeightBps:100,portfolioWeightBps:1e4,submissionOnlyDays:7,votingDays:30,initialVotes:3,voteUnlockIntervalDays:3,totalVotes:12,ruleVersion:"v4",rankingPolicyVersion:"earned-votes-v3"},f=864e5;function g(a){return new Date(new Date(a).getTime()+e.submissionOnlyDays*f)}function h(a,b=new Date){let c=g(a),d=b.getTime()-c.getTime();if(d<0)return 0;let i=Math.floor(d/f);return Math.min(e.totalVotes,e.initialVotes+Math.floor(i/e.voteUnlockIntervalDays))}function i(a,b=new Date){let c,d=new Date(a.startsAt),j=new Date(a.endsAt),k=g(d),l=Math.floor((b.getTime()-d.getTime())/f);return{stage:c="cancelled"===a.phase?"cancelled":"final"===a.phase?"final":"auditing"===a.phase||b>=j?"review":"draft"===a.phase||"scheduled"===a.phase||b<d?"upcoming":b<k?"submissions":"voting",competitionDay:Math.max(1,Math.min(e.submissionOnlyDays+e.votingDays,l+1)),votingStartsAt:k,unlockedVotes:h(d,b),nextVoteUnlockAt:"voting"===c?function(a,b=new Date){let c=h(a,b);if(0===c)return g(a);if(c>=e.totalVotes)return null;let d=c-e.initialVotes+1;return new Date(g(a).getTime()+d*e.voteUnlockIntervalDays*f)}(d,b):null,submissionsOpen:"submissions"===c||"voting"===c,votingOpen:"voting"===c}}function j(a,b=new Date){let c=i(a,b);return"upcoming"===c.stage?{...c,label:"Starts soon",tone:"neutral",deadlineLabel:"Submissions open",deadlineAt:new Date(a.startsAt)}:"submissions"===c.stage?{...c,label:"Submissions open",tone:"warning",deadlineLabel:"Voting opens",deadlineAt:c.votingStartsAt}:"voting"===c.stage?{...c,label:"Voting live",tone:"positive",deadlineLabel:"Voting closes",deadlineAt:new Date(a.endsAt)}:"review"===c.stage?{...c,label:"Final review",tone:"warning",deadlineLabel:"Voting closed",deadlineAt:new Date(a.endsAt)}:"final"===c.stage?{...c,label:"Results final",tone:"positive",deadlineLabel:"Voting closed",deadlineAt:new Date(a.endsAt)}:{...c,label:"Cancelled",tone:"danger",deadlineLabel:"Competition ended",deadlineAt:new Date(a.endsAt)}}},19121:a=>{"use strict";a.exports=require("next/dist/server/app-render/action-async-storage.external.js")},21820:a=>{"use strict";a.exports=require("os")},26351:(a,b,c)=>{"use strict";c.d(b,{Pt:()=>h,RG:()=>i,oh:()=>g});var d=c(77598);let e=["Bouncy","Cosmic","Dapper","Disco","Fizzy","Jolly","Mighty","Nifty","Peppy","Quirky","Sleepy","Sneaky","Spicy","Turbo","Velvet","Wobbly"],f=["Badger","Capybara","Ferret","Gecko","Lobster","Mango","Noodle","Otter","Penguin","Pigeon","Raccoon","Turnip","Walrus","Wombat","Yak","Zebra"];function g(a){let b=(0,d.createHash)("sha256").update(`otf-voter-alias-v1:${a}`).digest(),c=e[b[0]%e.length],g=f[b[1]%f.length],h=100+b.readUInt16BE(2)%900;return`${c} ${g} ${h}`}function h(a){return a.allowRealUsername?`@${a.username}`:g(a.userId)}function i(a){return[...a].sort((a,b)=>b.totalXp-a.totalXp||a.userId.localeCompare(b.userId)).map((a,b)=>({...a,rank:b+1}))}},27910:a=>{"use strict";a.exports=require("stream")},29021:a=>{"use strict";a.exports=require("fs")},29294:a=>{"use strict";a.exports=require("next/dist/server/app-render/work-async-storage.external.js")},34631:a=>{"use strict";a.exports=require("tls")},40582:()=>{},44870:a=>{"use strict";a.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},55511:a=>{"use strict";a.exports=require("crypto")},60027:(a,b,c)=>{"use strict";c.d(b,{Q0:()=>m,JV:()=>n,Ee:()=>o,HF:()=>q,$i:()=>r,if:()=>p});var d=c(11139);let e=[],f=[{id:"proposal-ai",slug:"ai-infrastructure-otf",rank:1,name:"AI Infrastructure OTF",ticker:"AIX",thesis:"Own the compute, power and platform layer behind the next decade of applied artificial intelligence.",creator:{xId:"101",username:"satoshi_data",displayName:"Satoshi Data"},votes:42,acceptedAt:"2026-08-09T10:04:00Z",allocations:[{assetId:"asset-nvda",symbol:"NVDA",name:"NVIDIA",weightBps:4e3,color:"#23d7b0"},{assetId:"asset-msft",symbol:"MSFT",name:"Microsoft",weightBps:3500,color:"#59a7ff"},{assetId:"asset-amd",symbol:"AMD",name:"AMD",weightBps:2500,color:"#a982ff"}]},{id:"proposal-magnificent",slug:"magnificent-seven-otf",rank:2,name:"Magnificent Seven OTF",ticker:"MAG7",thesis:"A concentrated basket of the category-defining US technology companies compounding at global scale.",creator:{xId:"102",username:"chaincap",displayName:"Chain Capital"},votes:35,acceptedAt:"2026-08-10T12:30:00Z",allocations:[{assetId:"asset-aapl",symbol:"AAPL",name:"Apple",weightBps:3e3,color:"#f0b65a"},{assetId:"asset-msft",symbol:"MSFT",name:"Microsoft",weightBps:2500,color:"#59a7ff"},{assetId:"asset-nvda",symbol:"NVDA",name:"NVIDIA",weightBps:2500,color:"#23d7b0"},{assetId:"asset-tsla",symbol:"TSLA",name:"Tesla",weightBps:2e3,color:"#e56f91"}]},{id:"proposal-autonomy",slug:"autonomy-otf",rank:3,name:"Autonomy OTF",ticker:"AUTO",thesis:"A focused portfolio for autonomous mobility, robotics and the silicon that makes physical AI possible.",creator:{xId:"103",username:"robotconomy",displayName:"Robotconomy"},votes:28,acceptedAt:"2026-08-11T14:15:00Z",allocations:[{assetId:"asset-tsla",symbol:"TSLA",name:"Tesla",weightBps:5e3,color:"#e56f91"},{assetId:"asset-nvda",symbol:"NVDA",name:"NVIDIA",weightBps:3e3,color:"#23d7b0"},{assetId:"asset-amd",symbol:"AMD",name:"AMD",weightBps:2e3,color:"#a982ff"}]},{id:"proposal-cloud",slug:"cloud-compounders-otf",rank:4,name:"Cloud Compounders OTF",ticker:"CLDX",thesis:"Durable software and cloud platforms with strong recurring revenue and expanding operating leverage.",creator:{xId:"104",username:"marble_fund",displayName:"Marble Fund"},votes:19,acceptedAt:"2026-08-12T09:10:00Z",allocations:[{assetId:"asset-msft",symbol:"MSFT",name:"Microsoft",weightBps:5500,color:"#59a7ff"},{assetId:"asset-aapl",symbol:"AAPL",name:"Apple",weightBps:4500,color:"#f0b65a"}]}],g=[{rank:1,publicName:"Turbo Capybara 404",usesRealUsername:!1,totalXp:1262715,votesCast:12,otfsSupported:4},{rank:2,publicName:"Disco Pigeon 808",usesRealUsername:!1,totalXp:1020460,votesCast:11,otfsSupported:3},{rank:3,publicName:"Wobbly Lobster 247",usesRealUsername:!1,totalXp:827341,votesCast:9,otfsSupported:2},{rank:4,publicName:"@public_voter",usesRealUsername:!0,totalXp:622108,votesCast:8,otfsSupported:3},{rank:5,publicName:"Sleepy Turnip 613",usesRealUsername:!1,totalXp:489484,votesCast:6,otfsSupported:2}],h=new Date(Date.now()-d.WW.submissionOnlyDays*d.sO-6e4),i=new Date(h.getTime()+(d.WW.submissionOnlyDays+d.WW.votingDays)*d.sO),j={id:"preview-competition",...d.$6,phase:"open",startsAt:h.toISOString(),endsAt:i.toISOString(),minFollowers:d.WW.minFollowers,minAccountAgeDays:d.WW.minAccountAgeDays,proposalCount:f.length,voteCount:f.reduce((a,b)=>a+b.votes,0),uniqueVoterCount:37};var k=c(26351),l=c(93257);async function m(){if(!l.z)return j;let a=await (0,l.z)`
    select c.id::text, ${d.$6.slug}::text as slug, ${d.$6.name}::text as name,
      c.phase, c.starts_at as "startsAt", c.ends_at as "endsAt",
      ${d.WW.minFollowers}::int as "minFollowers",
      ${d.WW.minAccountAgeDays}::int as "minAccountAgeDays",
      (select count(*)::int from proposals p where p.competition_id = c.id and p.status in ('accepted','hidden')) as "proposalCount",
      (select coalesce(sum(ba.votes), 0)::int from ballots b join ballot_allocations ba on ba.ballot_id = b.id where b.competition_id = c.id and b.status = 'valid') as "voteCount",
      (select count(*)::int from ballots b where b.competition_id = c.id and b.status = 'valid') as "uniqueVoterCount"
    from competitions c
    limit 1`;if(!a[0])throw Error("COMPETITION_NOT_FOUND");return a[0]}async function n(a=""){if(!l.z)return e;let b=a.trim().toLowerCase();return(0,l.z)`
    select ea.id::text, ea.symbol, ea.name, ea.contract_address as "contractAddress",
      ea.network, ea.chain_id as "chainId", ea.decimals,
      case when ea.quality = 'high' then 'high' else 'normal' end as quality,
      ea.price_source as "priceSource", latest.bid_usd::float8 as "latestPriceUsd",
      latest.sampled_at::text as "latestPriceAt",
      coalesce(configs.items, '[]'::json) as "pricingConfigs",
      coalesce(markets.items, '[]'::json) as markets
    from eligible_assets ea
    left join lateral (
      select aps.bid_usd, aps.sampled_at
      from asset_price_snapshots aps
      where aps.asset_id = ea.id
      order by aps.sampled_at desc
      limit 1
    ) latest on true
    left join lateral (
      select json_agg(case pc.source
        when 'chainlink-direct' then json_build_object(
          'id', pc.id::text, 'active', pc.active, 'source', pc.source, 'feedAddress', pc.primary_address
        )
        when 'chainlink-weth' then json_build_object(
          'id', pc.id::text, 'active', pc.active, 'source', pc.source,
          'assetWethFeedAddress', pc.primary_address, 'wethUsdFeedAddress', pc.secondary_address
        )
        else json_build_object(
          'id', pc.id::text, 'active', pc.active, 'source', pc.source, 'poolAddress', pc.primary_address
        ) end order by
          case pc.source when 'chainlink-direct' then 0 when 'chainlink-weth' then 1 else 2 end,
          pc.created_at) as items
      from asset_pricing_configs pc
      where pc.asset_id = ea.id
    ) configs on true
    left join lateral (
      select json_agg(json_build_object(
        'id', am.id::text, 'marketId', am.market_id, 'poolAddress', am.pool_address,
        'feeTier', am.fee_tier, 'active', am.active,
        'poolCreatedAt', am.pool_created_at,
        'quoteTokenAddress', am.quote_token_address,
        'evidenceStatus', evidence.status,
        'evidenceReasons', coalesce(evidence.reasons, ARRAY[]::text[])
      ) order by am.registered_at) as items
      from asset_markets am
      left join lateral (
        select aes.status, aes.reasons from asset_eligibility_snapshots aes
        where aes.market_id = am.id order by aes.sampled_at desc limit 1
      ) evidence on true
      where am.asset_id = ea.id
    ) markets on true
    where ${b} = '' or lower(ea.name) like ${`%${b}%`}
      or lower(ea.symbol) like ${`%${b}%`}
      or lower(ea.contract_address) = ${b}
    order by case when ea.quality = 'high' then 0 else 1 end, ea.symbol
    limit 100`}async function o(){return l.z?await (0,l.z)`
    with ranked as (
      select p.id, p.creator_user_id, p.slug, p.name, p.ticker, p.thesis, p.accepted_at,
        u.x_user_id, u.x_username, u.display_name as creator_name,
        u.profile_image_url as creator_profile_image_url,
        coalesce(sum(case when b.status = 'valid' then ba.votes else 0 end), 0)::int as votes
      from proposals p join users u on u.id = p.creator_user_id
      left join ballot_allocations ba on ba.proposal_id = p.id
      left join ballots b on b.id = ba.ballot_id
      where p.status = 'accepted' and p.competition_id = (select id from competitions limit 1)
      group by p.id, u.id
    ), ordered as (
      select *, row_number() over (order by votes desc, accepted_at asc, id asc)::int as rank from ranked
    )
    select o.id::text, o.slug, o.rank, o.name, o.ticker, o.thesis, o.votes,
      o.accepted_at as "acceptedAt",
      (select count(distinct vt.voter_user_id)::int from vote_tranches vt
        join ballots vb on vb.id = vt.ballot_id and vb.status = 'valid'
        join tweet_evidence ve on ve.id = vt.evidence_id and ve.status = 'valid'
        where vt.proposal_id = o.id and vt.voter_user_id <> o.creator_user_id) as "uniqueSupporterCount",
      (o.accepted_at < (select starts_at from competitions limit 1) + interval '7 days') as "submissionBoost",
      (select te.post_url from tweet_evidence te where te.proposal_id = o.id and te.action = 'submission' and te.status = 'valid' limit 1) as "proofUrl",
      json_build_object('xId', o.x_user_id, 'username', o.x_username, 'displayName', o.creator_name, 'profileImageUrl', o.creator_profile_image_url) as creator,
      case when exists (
        select 1 from proposal_assets quality_pa join eligible_assets quality_a on quality_a.id = quality_pa.asset_id
        where quality_pa.proposal_id = o.id and quality_a.quality <> 'high'
      ) then 'normal' else 'high' end as quality,
      coalesce((select json_agg(json_build_object(
        'assetId', pa.asset_id::text, 'symbol', a.symbol, 'name', a.name,
        'contractAddress', a.contract_address,
        'quality', case when a.quality = 'high' then 'high' else 'normal' end,
        'pricingConfig', case pa.pricing_source
          when 'chainlink-direct' then json_build_object('source', pa.pricing_source, 'feedAddress', pa.primary_address)
          when 'chainlink-weth' then json_build_object('source', pa.pricing_source, 'assetWethFeedAddress', pa.primary_address, 'wethUsdFeedAddress', pa.secondary_address)
          when 'uniswap-v3' then json_build_object('source', pa.pricing_source, 'poolAddress', pa.primary_address)
          else null end,
        'poolAddress', coalesce(case when pa.pricing_source = 'uniswap-v3' then pa.primary_address end, am.pool_address),
        'weightBps', pa.weight_bps
      ) order by pa.position) from proposal_assets pa join eligible_assets a on a.id = pa.asset_id
        left join asset_markets am on am.id = pa.market_id where pa.proposal_id = o.id), '[]') as allocations
    from ordered o order by o.rank`:f}async function p(){if(!l.z)return g;let a=await (0,l.z)`
    with latest_xp as (
      select id, competition_id from xp_calculation_runs
      order by case when status = 'final' then 0 else 1 end, calculated_at desc
      limit 1
    ), voter_scores as (
      select u.id as user_id, u.x_username,
        u.show_real_username_on_voter_leaderboard as allow_real_username,
        x.total_xp,
        coalesce(sum(ba.votes), 0)::int as votes_cast,
        count(distinct ba.proposal_id)::int as otfs_supported
      from latest_xp lx
      join xp_snapshot_rows x on x.run_id = lx.id
      join users u on u.id = x.user_id
      join ballots b on b.voter_user_id = x.user_id and b.competition_id = lx.competition_id and b.status = 'valid'
      left join ballot_allocations ba on ba.ballot_id = b.id
      group by b.id, u.id, x.total_xp
    )
    select user_id as "userId", x_username as username, allow_real_username as "allowRealUsername",
      total_xp as "totalXp", votes_cast as "votesCast", otfs_supported as "otfsSupported"
    from voter_scores
    order by total_xp desc, user_id`;return(0,k.RG)(a).map(a=>({rank:a.rank,publicName:(0,k.Pt)(a),usesRealUsername:a.allowRealUsername,totalXp:a.totalXp,votesCast:a.votesCast,otfsSupported:a.otfsSupported}))}async function q(a){return(await o()).find(b=>b.slug===a)??null}async function r(){return(await o()).map(({rank:a,slug:b,name:c,ticker:d})=>({rank:a,slug:b,name:c,ticker:d}))}},63033:a=>{"use strict";a.exports=require("next/dist/server/app-render/work-unit-async-storage.external.js")},73018:(a,b,c)=>{"use strict";c.d(b,{dp:()=>h,pb:()=>g,pc:()=>f});var d=c(34298),e=c(7469);function f(a,b){return d.NextResponse.json({data:a},b)}function g(a,b="INTERNAL_ERROR"){let c=a instanceof Error?a.message:b,f="UNAUTHENTICATED"===c?401:"FORBIDDEN"===c?403:c.includes("NOT_FOUND")?404:"DATABASE_NOT_CONFIGURED"===c||"X_UNAVAILABLE"===c||"RATE_LIMIT_UNAVAILABLE"===c||"FINAL_PRICE_CHECKPOINT_UNAVAILABLE"===c?503:"RATE_LIMITED"===c?429:400;return d.NextResponse.json({error:{code:c,...a instanceof e.S?{metadata:a.metadata}:{}}},{status:f})}function h(a){let b=a.headers.get("origin");if(b&&new URL(b).host!==new URL(a.url).host)throw Error("ORIGIN_MISMATCH")}},74998:a=>{"use strict";a.exports=require("perf_hooks")},75086:()=>{},77598:a=>{"use strict";a.exports=require("node:crypto")},77876:(a,b,c)=>{"use strict";c.r(b),c.d(b,{handler:()=>C,patchFetch:()=>B,routeModule:()=>x,serverHooks:()=>A,workAsyncStorage:()=>y,workUnitAsyncStorage:()=>z});var d={};c.r(d),c.d(d,{GET:()=>w});var e=c(80907),f=c(86996),g=c(74795),h=c(24739),i=c(77157),j=c(261),k=c(35847),l=c(93289),m=c(68195),n=c(59120),o=c(53358),p=c(28724),q=c(55694),r=c(95723),s=c(86439),t=c(24521),u=c(73018),v=c(60027);async function w(a){try{return(0,u.pc)("voters"===new URL(a.url).searchParams.get("view")?await (0,v.if)():await (0,v.Ee)())}catch(a){return(0,u.pb)(a)}}let x=new e.AppRouteRouteModule({definition:{kind:f.RouteKind.APP_ROUTE,page:"/api/v1/leaderboard/route",pathname:"/api/v1/leaderboard",filename:"route",bundlePath:"app/api/v1/leaderboard/route"},distDir:".next",relativeProjectDir:"",resolvedPagePath:"C:\\Users\\X1704\\Desktop\\onchaintradedfunds\\launch\\src\\app\\api\\v1\\leaderboard\\route.ts",nextConfigOutput:"",userland:d}),{workAsyncStorage:y,workUnitAsyncStorage:z,serverHooks:A}=x;function B(){return(0,g.patchFetch)({workAsyncStorage:y,workUnitAsyncStorage:z})}async function C(a,b,c){var d;let e="/api/v1/leaderboard/route";"/index"===e&&(e="/");let g=await x.prepare(a,b,{srcPage:e,multiZoneDraftMode:!1});if(!g)return b.statusCode=400,b.end("Bad Request"),null==c.waitUntil||c.waitUntil.call(c,Promise.resolve()),null;let{buildId:u,params:v,nextConfig:w,isDraftMode:y,prerenderManifest:z,routerServerContext:A,isOnDemandRevalidate:B,revalidateOnlyGenerated:C,resolvedPathname:D}=g,E=(0,j.normalizeAppPath)(e),F=!!(z.dynamicRoutes[E]||z.routes[D]);if(F&&!y){let a=!!z.routes[D],b=z.dynamicRoutes[E];if(b&&!1===b.fallback&&!a)throw new s.NoFallbackError}let G=null;!F||x.isDev||y||(G="/index"===(G=D)?"/":G);let H=!0===x.isDev||!F,I=F&&!H,J=a.method||"GET",K=(0,i.getTracer)(),L=K.getActiveScopeSpan(),M={params:v,prerenderManifest:z,renderOpts:{experimental:{cacheComponents:!!w.experimental.cacheComponents,authInterrupts:!!w.experimental.authInterrupts},supportsDynamicResponse:H,incrementalCache:(0,h.getRequestMeta)(a,"incrementalCache"),cacheLifeProfiles:null==(d=w.experimental)?void 0:d.cacheLife,isRevalidate:I,waitUntil:c.waitUntil,onClose:a=>{b.on("close",a)},onAfterTaskError:void 0,onInstrumentationRequestError:(b,c,d)=>x.onRequestError(a,b,d,A)},sharedContext:{buildId:u}},N=new k.NodeNextRequest(a),O=new k.NodeNextResponse(b),P=l.NextRequestAdapter.fromNodeNextRequest(N,(0,l.signalFromNodeResponse)(b));try{let d=async c=>x.handle(P,M).finally(()=>{if(!c)return;c.setAttributes({"http.status_code":b.statusCode,"next.rsc":!1});let d=K.getRootSpanAttributes();if(!d)return;if(d.get("next.span_type")!==m.BaseServerSpan.handleRequest)return void console.warn(`Unexpected root span type '${d.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let e=d.get("next.route");if(e){let a=`${J} ${e}`;c.setAttributes({"next.route":e,"http.route":e,"next.span_name":a}),c.updateName(a)}else c.updateName(`${J} ${a.url}`)}),g=async g=>{var i,j;let k=async({previousCacheEntry:f})=>{try{if(!(0,h.getRequestMeta)(a,"minimalMode")&&B&&C&&!f)return b.statusCode=404,b.setHeader("x-nextjs-cache","REVALIDATED"),b.end("This page could not be found"),null;let e=await d(g);a.fetchMetrics=M.renderOpts.fetchMetrics;let i=M.renderOpts.pendingWaitUntil;i&&c.waitUntil&&(c.waitUntil(i),i=void 0);let j=M.renderOpts.collectedTags;if(!F)return await (0,o.I)(N,O,e,M.renderOpts.pendingWaitUntil),null;{let a=await e.blob(),b=(0,p.toNodeOutgoingHttpHeaders)(e.headers);j&&(b[r.NEXT_CACHE_TAGS_HEADER]=j),!b["content-type"]&&a.type&&(b["content-type"]=a.type);let c=void 0!==M.renderOpts.collectedRevalidate&&!(M.renderOpts.collectedRevalidate>=r.INFINITE_CACHE)&&M.renderOpts.collectedRevalidate,d=void 0===M.renderOpts.collectedExpire||M.renderOpts.collectedExpire>=r.INFINITE_CACHE?void 0:M.renderOpts.collectedExpire;return{value:{kind:t.CachedRouteKind.APP_ROUTE,status:e.status,body:Buffer.from(await a.arrayBuffer()),headers:b},cacheControl:{revalidate:c,expire:d}}}}catch(b){throw(null==f?void 0:f.isStale)&&await x.onRequestError(a,b,{routerKind:"App Router",routePath:e,routeType:"route",revalidateReason:(0,n.c)({isRevalidate:I,isOnDemandRevalidate:B})},A),b}},l=await x.handleResponse({req:a,nextConfig:w,cacheKey:G,routeKind:f.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:z,isRoutePPREnabled:!1,isOnDemandRevalidate:B,revalidateOnlyGenerated:C,responseGenerator:k,waitUntil:c.waitUntil});if(!F)return null;if((null==l||null==(i=l.value)?void 0:i.kind)!==t.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==l||null==(j=l.value)?void 0:j.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});(0,h.getRequestMeta)(a,"minimalMode")||b.setHeader("x-nextjs-cache",B?"REVALIDATED":l.isMiss?"MISS":l.isStale?"STALE":"HIT"),y&&b.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let m=(0,p.fromNodeOutgoingHttpHeaders)(l.value.headers);return(0,h.getRequestMeta)(a,"minimalMode")&&F||m.delete(r.NEXT_CACHE_TAGS_HEADER),!l.cacheControl||b.getHeader("Cache-Control")||m.get("Cache-Control")||m.set("Cache-Control",(0,q.getCacheControlHeader)(l.cacheControl)),await (0,o.I)(N,O,new Response(l.value.body,{headers:m,status:l.value.status||200})),null};L?await g(L):await K.withPropagatedContext(a.headers,()=>K.trace(m.BaseServerSpan.handleRequest,{spanName:`${J} ${a.url}`,kind:i.SpanKind.SERVER,attributes:{"http.method":J,"http.target":a.url}},g))}catch(b){if(b instanceof s.NoFallbackError||await x.onRequestError(a,b,{routerKind:"App Router",routePath:E,routeType:"route",revalidateReason:(0,n.c)({isRevalidate:I,isOnDemandRevalidate:B})}),F)throw b;return await (0,o.I)(N,O,new Response(null,{status:500})),null}}},86439:a=>{"use strict";a.exports=require("next/dist/shared/lib/no-fallback-error.external")},91645:a=>{"use strict";a.exports=require("net")}};var b=require("../../../../webpack-runtime.js");b.C(a);var c=b.X(0,[5191,2043,3257],()=>b(b.s=77876));module.exports=c})();