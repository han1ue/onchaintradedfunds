import { BadgeCheck, PenLine, ShieldCheck } from "lucide-react";
import { Button, SectionCard } from "./ui";

export function HowItWorks({ connected = false }: { connected?: boolean }) {
  const steps = [
    { icon: BadgeCheck, title: "Connect X", text: "Use a verified, public X account." },
    { icon: PenLine, title: "Create or vote", text: "Build an OTF or back the ones you believe in." },
    { icon: ShieldCheck, title: "Verify your post", text: "Share your reason on X and paste the post URL." }
  ];
  return <SectionCard className="howCard"><div className="cardHeading"><span>How it works</span><small>Verified actions only</small></div>
    <ol className="steps">{steps.map(({ icon: Icon, title, text }, index) => <li key={title}><div className="stepIcon"><Icon size={20} /></div><span className="stepNumber">{index + 1}</span><div><strong>{title}</strong><p>{text}</p></div></li>)}</ol>
    <Button href={connected ? "/submit" : "/api/auth/signin?callbackUrl=%2F"}>{connected ? "Submit OTF" : "Connect X to get started"}</Button>
    <p className="finePrint">We never post without your permission.</p>
  </SectionCard>;
}
