"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Play,
  Square,
  RotateCcw,
  Minus,
  Plus,
  Flame,
  Bell,
  BellOff,
  Mic,
  MicOff,
  AlertCircle
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Toaster, toast } from "sonner";
import { cn } from "@/lib/utils";

// --- CONFIGURATION ---
const MODEL_URL = process.env.NEXT_PUBLIC_MODEL_URL;
const WHISTLE_CLASS_NAME = "Whistle";
const CONFIDENCE_THRESHOLD = 0.85;
const COOLDOWN_MS = 4000;

export default function WhistleTracker() {
  // State
  const [targetWhistles, setTargetWhistles] = useState(3);
  const [currentCount, setCurrentCount] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [isAlarmActive, setIsAlarmActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs
  const recognizerRef = useRef<any>(null);
  const wakeLockRef = useRef<any>(null);
  const lastDetectionTimeRef = useRef<number>(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const alarmTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Audio Feedack (Rhythmic Alarm and Speech)
  const playAlarmBeeps = useCallback(() => {
    if (typeof window === "undefined") return;
    
    // Close previous context if exists
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
    }

    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    audioContextRef.current = audioContext;
    
    const playBeep = (startTime: number) => {
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.type = "square";
      oscillator.frequency.setValueAtTime(880, startTime); 
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      gainNode.gain.setValueAtTime(0, startTime);
      gainNode.gain.linearRampToValueAtTime(0.3, startTime + 0.05);
      gainNode.gain.linearRampToValueAtTime(0.3, startTime + 0.2);
      gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + 0.25);

      oscillator.start(startTime);
      oscillator.stop(startTime + 0.25);
    };

    const now = audioContext.currentTime;
    playBeep(now);
    playBeep(now + 0.4);
    playBeep(now + 0.8);
  }, []);

  const speakCompletion = () => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      const utterance = new SpeechSynthesisUtterance("Cooking complete");
      utterance.rate = 0.9;
      utterance.pitch = 1.1;
      window.speechSynthesis.speak(utterance);
    }
  };

  // Alarm Control Loop
  useEffect(() => {
    if (isAlarmActive) {
      const runAlarm = () => {
        playAlarmBeeps();
        speakCompletion();
        alarmTimeoutRef.current = setTimeout(runAlarm, 3000);
      };

      runAlarm();
      
      return () => {
        if (alarmTimeoutRef.current) {
          clearTimeout(alarmTimeoutRef.current);
          alarmTimeoutRef.current = null;
        }
        if (audioContextRef.current) {
          audioContextRef.current.close().catch(() => {});
          audioContextRef.current = null;
        }
        if (typeof window !== "undefined") {
          window.speechSynthesis.cancel();
        }
      };
    }
  }, [isAlarmActive, playAlarmBeeps]);

  const stopAlarm = () => {
    setIsAlarmActive(false);
    toast.success("Alarm stopped.");
  };

  // Screen Wake Lock
  const requestWakeLock = async () => {
    if (typeof navigator !== "undefined" && "wakeLock" in navigator) {
      try {
        wakeLockRef.current = await (navigator as any).wakeLock.request("screen");
      } catch (err) {
        console.error("Wake Lock failed:", err);
      }
    }
  };

  const releaseWakeLock = () => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release();
      wakeLockRef.current = null;
    }
  };

  const stopListening = useCallback(() => {
    if (recognizerRef.current) {
      recognizerRef.current.stopListening();
      recognizerRef.current = null;
    }
    setIsListening(false);
    releaseWakeLock();
  }, []);

  // Completion Handler
  const handleCompletion = useCallback(() => {
    stopListening();
    setIsAlarmActive(true);

    if (typeof window !== "undefined" && Notification.permission === "granted") {
      new Notification("Cooker Companion", {
        body: "Food is ready! Turn off the stove.",
      });
    } else {
      toast.success("Food is ready! Turn off the stove.", { duration: 10000 });
    }

    toast("Cooking Complete!", {
      description: `Reached ${targetWhistles} whistles.`,
    });
  }, [targetWhistles, stopListening]);

  // Model Logic
  const startListening = async () => {
    if (!MODEL_URL || MODEL_URL.includes("YOUR_TEACHABLE_MACHINE")) {
      toast.error("Please provide a valid Teachable Machine model URL.");
      return;
    }

    try {
      setIsModelLoading(true);
      setError(null);

      // Check for global availability from CDN
      const tf = (window as any).tf;
      const speechCommands = (window as any).speechCommands;

      if (!tf || !speechCommands) {
        throw new Error("TensorFlow.js or Speech Commands not loaded yet. please wait a moment and try again.");
      }

      // Ensure TF is ready and has a backend
      await tf.ready();

      // Try to find an available backend
      const backends = ["webgl", "cpu"];
      let foundBackend = false;
      for (const b of backends) {
        try {
          await tf.setBackend(b);
          console.log(`Backend set to: ${b}`);
          foundBackend = true;
          break;
        } catch (e) {
          console.warn(`Failed to set backend ${b}:`, e);
        }
      }

      if (!foundBackend) {
        throw new Error("No available TensorFlow.js backend found (WebGL/CPU).");
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());

      const checkpointURL = `${MODEL_URL}model.json`;
      const metadataURL = `${MODEL_URL}metadata.json`;

      const recognizer = speechCommands.create(
        "BROWSER_FFT",
        undefined,
        checkpointURL,
        metadataURL
      );

      await recognizer.ensureModelLoaded();
      recognizerRef.current = recognizer;

      const classLabels = recognizer.wordLabels();

      await recognizer.listen(async (result: any) => {
        const scores = Array.from(result.scores as Float32Array);
        const whistleIndex = classLabels.indexOf(WHISTLE_CLASS_NAME);

        if (whistleIndex !== -1) {
          const whistleScore = scores[whistleIndex];
          const now = Date.now();

          if (whistleScore > CONFIDENCE_THRESHOLD && (now - lastDetectionTimeRef.current) > COOLDOWN_MS) {
            lastDetectionTimeRef.current = now;
            setCurrentCount((prev) => {
              const nextCount = prev + 1;
              if (nextCount >= targetWhistles) {
                setTimeout(() => handleCompletion(), 100);
              }
              return nextCount;
            });
            toast.message("Whistle detected!", {
              description: "Incrementing whistle count.",
            });
          }
        }
      }, {
        probabilityThreshold: 0.75,
        overlapFactor: 0.5,
      });

      setIsListening(true);
      requestWakeLock();
      toast.info("Listening for whistles...");
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to start microphone.");
      toast.error(err.message || "Microphone access denied or model failed to load.");
    } finally {
      setIsModelLoading(false);
    }
  };

  const resetCounter = () => {
    setCurrentCount(0);
    lastDetectionTimeRef.current = 0;
    toast("Counter reset.");
  };

  // Initialize Notifications
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
    return () => {
      stopListening();
    };
  }, [stopListening]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 flex flex-col items-center justify-between p-6 overflow-hidden relative w-full">
      <Toaster position="top-center" richColors />

      {/* Background Decoration */}
      <div className="absolute inset-0 bg-gradient-to-b from-orange-500/10 to-transparent pointer-events-none" />
      <div className="absolute -top-24 -left-24 w-64 h-64 bg-orange-600/20 rounded-full blur-3xl p-4" />
      <div className="absolute -bottom-24 -right-24 w-64 h-64 bg-blue-600/10 rounded-full blur-3xl p-4" />

      {/* Header */}
      <header className="z-10 w-full max-w-md flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="bg-orange-500 p-2 rounded-xl shadow-lg shadow-orange-500/20">
            <Flame className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-xl font-bold tracking-tight italic">Cooker Companion</h1>
        </div>
        <button
          onClick={resetCounter}
          className="p-2 rounded-full hover:bg-slate-800 transition-colors text-slate-400 hover:text-slate-100"
          title="Reset Counter"
        >
          <RotateCcw className="w-5 h-5" />
        </button>
      </header>

      {/* Main Display */}
      <main className="z-10 flex-1 flex flex-col items-center justify-center w-full max-w-md gap-12">
        <div className="relative group">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentCount}
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 1.2, opacity: 0 }}
              className="text-[12rem] font-black leading-none tracking-tighter tabular-nums drop-shadow-2xl"
            >
              {currentCount}
            </motion.div>
          </AnimatePresence>
          <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 text-slate-500 font-medium uppercase tracking-widest text-sm">
            Whistles
          </div>

          {isListening && (
            <div className="absolute inset-0 -z-10">
              <span className="absolute inset-0 rounded-full border border-orange-500/20 animate-ping" />
              <span className="absolute inset-0 rounded-full border border-orange-500/10 animate-ping delay-300" />
            </div>
          )}
        </div>

        <div className="w-full bg-slate-900/50 backdrop-blur-xl border border-slate-800 rounded-3xl p-6 flex flex-col gap-6 shadow-2xl">
          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-slate-400 text-xs uppercase tracking-widest mb-1">Target</span>
              <span className="text-lg font-semibold">Whistles</span>
            </div>

            <div className="flex items-center gap-4 bg-slate-950/50 p-1 rounded-2xl border border-slate-800">
              <button
                onClick={() => setTargetWhistles(Math.max(1, targetWhistles - 1))}
                disabled={isListening}
                className="p-3 rounded-xl hover:bg-slate-800 disabled:opacity-50 transition-colors"
                aria-label="Decrease Target"
              >
                <Minus className="w-5 h-5" />
              </button>
              <span className="text-2xl font-bold w-8 text-center tabular-nums">{targetWhistles}</span>
              <button
                onClick={() => setTargetWhistles(targetWhistles + 1)}
                disabled={isListening}
                className="p-3 rounded-xl hover:bg-slate-800 disabled:opacity-50 transition-colors"
                aria-label="Increase Target"
              >
                <Plus className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Footer / Action */}
      <footer className="z-10 w-full max-w-md pb-8 flex flex-col gap-4">
        {isAlarmActive ? (
          <button
            onClick={stopAlarm}
            className="w-full py-6 rounded-[2.5rem] font-bold text-xl flex items-center justify-center gap-3 transition-all active:scale-95 shadow-2xl bg-red-500 text-white hover:bg-red-600 shadow-red-500/20 animate-bounce"
          >
            <BellOff className="w-6 h-6" />
            Stop Alarm
          </button>
        ) : (
          <button
            onClick={isListening ? stopListening : startListening}
            disabled={isModelLoading}
            className={cn(
              "w-full py-6 rounded-[2.5rem] font-bold text-xl flex items-center justify-center gap-3 transition-all active:scale-95 shadow-2xl",
              isListening
                ? "bg-slate-50 text-slate-950 hover:bg-slate-200"
                : "bg-orange-500 text-white hover:bg-orange-600 shadow-orange-500/20"
            )}
          >
            {isModelLoading ? (
              <div className="w-6 h-6 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : isListening ? (
              <>
                <Square className="fill-current w-5 h-5" />
                Stop Cooking
              </>
            ) : (
              <>
                <Play className="fill-current w-5 h-5 ml-1" />
                Start Cooking
              </>
            )}
          </button>
        )}

        <div className="mt-8 flex justify-center gap-8 text-slate-500">
          <div className={cn("flex items-center gap-2 transition-colors", isListening ? "text-orange-500" : "")}>
            <div className={cn("w-2 h-2 rounded-full", isListening ? "bg-orange-500 animate-pulse" : "bg-slate-700")} />
            <span className="text-xs font-medium uppercase tracking-widest">
              {isListening ? "Listening" : "Standby"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className={cn("w-2 h-2 rounded-full bg-slate-700")} />
            <span className="text-xs font-medium uppercase tracking-widest">Wake Lock</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
