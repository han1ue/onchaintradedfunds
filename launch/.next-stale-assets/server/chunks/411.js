"use strict";exports.id=411,exports.ids=[411],exports.modules={1843:(a,b,c)=>{c.d(b,{H:()=>h});var d=c(45836),e=c(93257),f=c(83698),g=c(60071);async function h(a,b){let c={minFollowers:b.minFollowers,minAccountAgeDays:b.minAccountAgeDays};if(!a?.id||!a.xUserId)return{...c,connected:!1,eligible:!1,verified:null,publicAccount:null,followersCount:null,oldEnough:null};if(!e.db)return{...c,connected:!0,eligible:!1,verified:null,publicAccount:null,followersCount:null,oldEnough:null};let[h]=await e.db.select().from(f.users).where((0,d.eq)(f.users.id,a.id)).limit(1);if(!h||h.xUserId!==a.xUserId)return{...c,connected:!0,eligible:!1,verified:null,publicAccount:null,followersCount:null,oldEnough:null};let i=!h.protected,j=Date.now()-h.accountCreatedAt.getTime()>=864e5*b.minAccountAgeDays,k=(0,g.u)(h.xUserId);return{...c,connected:!0,eligible:i&&j&&(k||h.verified&&h.followersCount>=b.minFollowers),verified:h.verified,publicAccount:i,followersCount:h.followersCount,oldEnough:j}}},60027:(a,b,c)=>{c.d(b,{Q0:()=>m,JV:()=>n,Ee:()=>o,HF:()=>q,$i:()=>r,if:()=>p});var d=c(11139);let e=[],f=[{id:"proposal-ai",slug:"ai-infrastructure-otf",rank:1,name:"AI Infrastructure OTF",ticker:"AIX",thesis:"Own the compute, power and platform layer behind the next decade of applied artificial intelligence.",creator:{xId:"101",username:"satoshi_data",displayName:"Satoshi Data"},votes:42,acceptedAt:"2026-08-09T10:04:00Z",allocations:[{assetId:"asset-nvda",symbol:"NVDA",name:"NVIDIA",weightBps:4e3,color:"#23d7b0"},{assetId:"asset-msft",symbol:"MSFT",name:"Microsoft",weightBps:3500,color:"#59a7ff"},{assetId:"asset-amd",symbol:"AMD",name:"AMD",weightBps:2500,color:"#a982ff"}]},{id:"proposal-magnificent",slug:"magnificent-seven-otf",rank:2,name:"Magnificent Seven OTF",ticker:"MAG7",thesis:"A concentrated basket of the category-defining US technology companies compounding at global scale.",creator:{xId:"102",username:"chaincap",displayName:"Chain Capital"},votes:35,acceptedAt:"2026-08-10T12:30:00Z",allocations:[{assetId:"asset-aapl",symbol:"AAPL",name:"Apple",weightBps:3e3,color:"#f0b65a"},{assetId:"asset-msft",symbol:"MSFT",name:"Microsoft",weightBps:2500,color:"#59a7ff"},{assetId:"asset-nvda",symbol:"NVDA",name:"NVIDIA",weightBps:2500,color:"#23d7b0"},{assetId:"asset-tsla",symbol:"TSLA",name:"Tesla",weightBps:2e3,color:"#e56f91"}]},{id:"proposal-autonomy",slug:"autonomy-otf",rank:3,name:"Autonomy OTF",ticker:"AUTO",thesis:"A focused portfolio for autonomous mobility, robotics and the silicon that makes physical AI possible.",creator:{xId:"103",username:"robotconomy",displayName:"Robotconomy"},votes:28,acceptedAt:"2026-08-11T14:15:00Z",allocations:[{assetId:"asset-tsla",symbol:"TSLA",name:"Tesla",weightBps:5e3,color:"#e56f91"},{assetId:"asset-nvda",symbol:"NVDA",name:"NVIDIA",weightBps:3e3,color:"#23d7b0"},{assetId:"asset-amd",symbol:"AMD",name:"AMD",weightBps:2e3,color:"#a982ff"}]},{id:"proposal-cloud",slug:"cloud-compounders-otf",rank:4,name:"Cloud Compounders OTF",ticker:"CLDX",thesis:"Durable software and cloud platforms with strong recurring revenue and expanding operating leverage.",creator:{xId:"104",username:"marble_fund",displayName:"Marble Fund"},votes:19,acceptedAt:"2026-08-12T09:10:00Z",allocations:[{assetId:"asset-msft",symbol:"MSFT",name:"Microsoft",weightBps:5500,color:"#59a7ff"},{assetId:"asset-aapl",symbol:"AAPL",name:"Apple",weightBps:4500,color:"#f0b65a"}]}],g=[{rank:1,publicName:"Turbo Capybara 404",usesRealUsername:!1,totalXp:1262715,votesCast:12,otfsSupported:4},{rank:2,publicName:"Disco Pigeon 808",usesRealUsername:!1,totalXp:1020460,votesCast:11,otfsSupported:3},{rank:3,publicName:"Wobbly Lobster 247",usesRealUsername:!1,totalXp:827341,votesCast:9,otfsSupported:2},{rank:4,publicName:"@public_voter",usesRealUsername:!0,totalXp:622108,votesCast:8,otfsSupported:3},{rank:5,publicName:"Sleepy Turnip 613",usesRealUsername:!1,totalXp:489484,votesCast:6,otfsSupported:2}],h=new Date(Date.now()-d.WW.submissionOnlyDays*d.sO-6e4),i=new Date(h.getTime()+(d.WW.submissionOnlyDays+d.WW.votingDays)*d.sO),j={id:"preview-competition",...d.$6,phase:"open",startsAt:h.toISOString(),endsAt:i.toISOString(),minFollowers:d.WW.minFollowers,minAccountAgeDays:d.WW.minAccountAgeDays,proposalCount:f.length,voteCount:f.reduce((a,b)=>a+b.votes,0),uniqueVoterCount:37};var k=c(26351),l=c(93257);async function m(){if(!l.z)return j;let a=await (0,l.z)`
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
    order by total_xp desc, user_id`;return(0,k.RG)(a).map(a=>({rank:a.rank,publicName:(0,k.Pt)(a),usesRealUsername:a.allowRealUsername,totalXp:a.totalXp,votesCast:a.votesCast,otfsSupported:a.otfsSupported}))}async function q(a){return(await o()).find(b=>b.slug===a)??null}async function r(){return(await o()).map(({rank:a,slug:b,name:c,ticker:d})=>({rank:a,slug:b,name:c,ticker:d}))}},60071:(a,b,c)=>{c.d(b,{u:()=>e});let d=new Set(["2027340342585077760"]);function e(a){return d.has(a?.trim()??"")}},75447:(a,b,c)=>{c.d(b,{EligibilityAction:()=>o});var d=c(51339),e=c(36698),f=c.n(e),g=c(90384),h=c(24676),i=c(74490),j=c(30700),k=c(44647),l=c(34190);function m(a){return null===a?"unknown":a?"met":"failed"}function n({eligibility:a,action:b,callbackUrl:c,open:e,onClose:f}){let n=(0,l.useRef)(null),[o,p]=(0,l.useState)(!1),[q,r]=(0,l.useState)(null),s=null===a.verified||null===a.publicAccount?null:a.verified&&a.publicAccount,t=null===a.followersCount?null:a.followersCount>=a.minFollowers;async function u(){p(!0),r(null);try{if(a.connected&&!(await fetch("/api/auth/x/disconnect",{method:"POST"})).ok)throw Error("DISCONNECT_FAILED");window.location.assign(`/api/auth/x?callbackUrl=${encodeURIComponent(c)}&forceLogin=1`)}catch{p(!1),r("We couldn’t disconnect this account. Close this message and try again.")}}let v=a.connected?"This X account isn’t eligible":`Sign in to ${"vote"===b?"vote":"submit an OTF proposal"}`;return(0,d.jsx)("dialog",{ref:n,className:"eligibilityDialog",onClose:f,onCancel:f,"aria-labelledby":"eligibility-title",children:(0,d.jsxs)("div",{className:"eligibilityDialogBody",children:[(0,d.jsx)("button",{className:"dialogClose",type:"button",onClick:f,"aria-label":"Close eligibility requirements",children:(0,d.jsx)(g.A,{size:17})}),(0,d.jsx)("div",{className:"eligibilityDialogIcon",children:(0,d.jsx)(h.A,{size:24,"aria-hidden":"true"})}),(0,d.jsx)("h2",{id:"eligibility-title",children:v}),(0,d.jsx)("p",{children:"To submit a proposal or vote, connect an X account that currently meets every requirement."}),(0,d.jsxs)("div",{className:"eligibilityRequirements",children:[(0,d.jsxs)("div",{"data-state":m(s),children:[(0,d.jsx)(i.A,{size:17}),(0,d.jsx)("strong",{children:"Verified and public"})]}),(0,d.jsxs)("div",{"data-state":m(t),children:[(0,d.jsx)(j.A,{size:17}),(0,d.jsxs)("strong",{children:["At least ",a.minFollowers.toLocaleString()," followers"]})]}),(0,d.jsxs)("div",{"data-state":m(a.oldEnough),children:[(0,d.jsx)(k.A,{size:17}),(0,d.jsxs)("strong",{children:["At least ",a.minAccountAgeDays," days old"]})]})]}),(0,d.jsxs)("div",{className:"eligibilityDialogActions",children:[(0,d.jsx)("button",{className:"button buttonPrimary",type:"button",onClick:u,disabled:o,children:o?"Opening X…":a.connected?"Use another X account":"Sign in with X"}),(0,d.jsx)("button",{className:"button buttonSecondary",type:"button",onClick:f,children:"Close"})]}),q&&(0,d.jsx)("p",{className:"eligibilityDialogMessage",role:"status",children:q})]})})}function o({eligibility:a,action:b,callbackUrl:c,href:e,className:g="button buttonPrimary",autoOpen:h=!1,children:i}){let[j,k]=(0,l.useState)(h&&!a.eligible);return a.eligible&&e?(0,d.jsx)(f(),{className:g,href:e,children:i}):(0,d.jsxs)(d.Fragment,{children:[(0,d.jsx)("button",{className:g,type:"button",onClick:()=>k(!0),children:i}),(0,d.jsx)(n,{eligibility:a,action:b,callbackUrl:c,open:j,onClose:()=>k(!1)})]})}}};