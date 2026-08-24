# Tempus Sales Copilot: video script

Approx. 5 minutes at a normal speaking pace. Stage directions in brackets.

---

**[Open on the ranked territory, map visible]**

So here's the problem I set out to solve. A Tempus sales rep is not short on data. They're short on the next action. Market spreadsheet over here, CRM over there, provider registry, trial feeds, payment records, product documentation, and somewhere in the middle of all of that is the answer to "who do I call on Monday". Right now they stitch that together by hand, and yes that's slow, but honestly that's not the part that worries me. The part that worries me is that whatever they end up saying out loud might be stale, or just not backed by anything. So I built an explainable sales prep tool, and I want to be really clear about what it isn't: it is not a clinical recommendation system, and it is not predicting which doctors are good. It answers three questions. Who first, why now, and what do I say.

**[Scroll the queue, hover a couple of rows]**

Lemme show you. This is the ranked call list, and I built it as a transparent weighted formula rather than a model, and here's why. There is no real conversion history to train on. None. So I could either ship a black box I can't explain, or an honest heuristic I can defend line by line, and for a rep who has to justify how they spent their day, that's not a close call. Thirty two percent estimated patient opportunity, twenty percent identity confidence, seventeen percent panel fit, thirteen percent CRM engagement, ten percent record freshness, eight percent market trial density. Opportunity leads because patient impact is the whole point of the brief. Identity and freshness are in there so that a record I can't trust can't outrank one I can.

Now, panel fit. You might wonder why that isn't just "who sees the most patients", and first I did too. But watch what happens if you multiply patient count into it. The opportunity term already carries the volume, so you'd be counting it twice, and the ranking quietly turns into a headcount sort. So panel fit scores the match rate instead, and it names the panel. Colorectal heavy practice routes to xT CDx. A practice where the tissue keeps coming back inadequate routes to xF.

**[Open a doctor profile]**

Open a physician and you get the dossier. Identity, practice, priority score, and then this strip of signals: identity confidence, contested fields, claims verified, sources cited, estimated patients, panel fit. And here's the bit I like. Every one of those numbers is a link. Click it, and it jumps you straight down to the section that has to justify it. You should never have to take a number on faith inside your own tool.

Under that is Why now, and this is because I treat a reason to call as a dated event that decays, not a standing fact. A paper they published last month beats "the FDA updated a label", because the FDA thing is true for every doctor in the city. That's context, not a trigger. Then your thirty second opener, and the pushback you should expect, with a response already sitting there.

**[Expand the evidence and verification section]**

Okay. This is the part I actually care about. Everyone builds a generator. I built a verifier. You see, drafting a pitch is one model call, that's the easy half. Knowing the pitch is true before a rep says it to a chief medical officer, at a company operating under FDA labelling, that's the half you have to engineer.

So the model never writes prose that reaches the user. It emits structured claims that each name their evidence, and the final copy gets assembled only from the claims that survive four gates. Untrusted CRM text gets screened for injection and PHI before a prompt is even built. Weak evidence grades get rejected. Every number has to appear verbatim in a cited source, and that gate is fully deterministic, no model involved, because numbers are where a hallucination does the most damage and where I can actually prove I caught it. Then a second, different model checks entailment, blind to the prompt that generated the claim, because a model grading its own homework is not a check. Anything that fails is withheld, and you can see exactly why.

And pricing? Still refused, on purpose. No approved source states it, so it doesn't get said. I did find a real source for turnaround time in the 10-K, so that objection got a real answer. The refusal path never got weakened just to make a demo look good.

Real data disagrees, by the way. In live Chicago data, NPPES lists one specialty for a doctor and CMS lists another. So where sources disagree, the field is marked contested, confidence drops, and the rep is told to go verify, instead of me picking a winner quietly behind their back.

**[Pan the map, toggle accounts view]**

Now the design, because I made real choices here and I want to walk you through them. It's a two pane workspace. Ranked queue on the left, one focused stage on the right, and the detail lives inside disclosures that stay shut until you ask for them. That's because the default view should answer who to call and what to say, not dump the entire evidence graph on you the second you land.

The ground is the live territory, and the panels are translucent glass sitting on top of it, frosted into paper under the reading column and masked away toward the right, so the map stays sharp exactly where nothing is written over it. Colour only ever means one thing here. Green agreed, amber verify, red withheld, cyan live federal data, violet simulated. Numbers are set in mono so columns of them line up. And anything the rep is meant to read out loud is set in a serif, so at a glance you know what's yours to say. Small thing, but it's the difference between reading and performing. Oh, and house style is enforced in code, not asked for in a prompt, because a model follows a style rule most of the time, and most of the time isn't a rule.

**[Back to the full territory]**

Last thing, the limits, because I'd rather say them than have you find them. That market CSV is a vendor's modelled estimate, not observed patient counts, so I treat it as untrusted input to cross check, not as ground truth. The weights are product assumptions, not values learned from Tempus outcomes. The panel fit rules are call planning heuristics, not clinical advice. Missing information stays visible and lowers confidence rather than getting invented. And every generated sentence still needs a human before it's said to a chief medical officer.

That's the whole design, really. Not the most polished copy. Copy you can check.
