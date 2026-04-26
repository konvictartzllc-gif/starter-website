import { useEffect, useState } from "react";
import { api } from "../utils/api";

export default function Onboarding() {
  const [show, setShow] = useState(false);
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check if onboarding is needed (first run)
    api.getMemory().then(({ memory }) => {
      if (!memory || !memory.onboarded) setShow(true);
      setLoading(false);
    });
  }, []);

  async function handleNext() {
    if (step === 2) {
      await api.setMemory("onboarded", "1");
      setShow(false);
    } else {
      setStep(step + 1);
    }
  }

  if (loading || !show) return null;

  const steps = [
    <div key="intro">
      <h2>Welcome to Dex AI</h2>
      <p>I'm Dex, your personal learning AI. I start as a blank slate and adapt to you—no restrictions, no pre-set routines.</p>
      <button onClick={handleNext}>Next</button>
    </div>,
    <div key="consent">
      <h2>Consent First</h2>
      <p>I will always ask before taking any sensitive action, like answering calls or sending messages. You are always in control.</p>
      <button onClick={handleNext}>Next</button>
    </div>,
    <div key="ready">
      <h2>Ready to Learn</h2>
      <p>As you use Dex, I'll learn your preferences and offer new features—always with your permission. Let's get started!</p>
      <button onClick={handleNext}>Finish</button>
    </div>
  ];

  return (
    <div className="onboarding-modal">
      {steps[step]}
    </div>
  );
}