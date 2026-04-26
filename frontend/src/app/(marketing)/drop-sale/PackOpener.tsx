"use client";

import { useState, useEffect, useMemo } from "react";

interface CardInfo {
  cardId: string;
  name: string;
  cardSet: string;
  rarity: string;
  marketValueUsd: string;
  imageUrl: string;
}

interface PackOpenerProps {
  cards: CardInfo[];
  tierId: string;
  onClose: () => void;
}

export default function PackOpener({ cards, tierId, onClose }: PackOpenerProps) {
  const [stage, setStage] = useState<"holding" | "opening" | "revealing" | "summary">("holding");
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [animatingCard, setAnimatingCard] = useState(false);

  const totalPrice = useMemo(() => {
    return cards.reduce((sum, card) => sum + parseFloat(card.marketValueUsd || "0"), 0).toFixed(2);
  }, [cards]);

  const handlePackClick = () => {
    if (stage !== "holding") return;
    setStage("opening");
    setTimeout(() => {
      setStage("revealing");
    }, 800);
  };

  const handleCardClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (animatingCard) return;

    if (currentCardIndex < cards.length - 1) {
      setAnimatingCard(true);
      setTimeout(() => {
        setCurrentCardIndex((prev) => prev + 1);
        setAnimatingCard(false);
      }, 500);
    } else {
      setStage("summary");
    }
  };

  // Prevent background scroll
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "auto";
    };
  }, []);

  const currentCard = cards[currentCardIndex];

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center isolate overflow-hidden bg-slate-950/40 backdrop-blur-3xl">
      {/* Background radial glow */}
      <div className="absolute inset-0 z-0 bg-[radial-gradient(circle_at_center,rgba(56,189,248,0.2)_0%,transparent_70%)] animate-pulse" />
      
      {/* Particle container (Simulated with CSS) */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-30">
        {[...Array(20)].map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-white/20 blur-sm animate-float"
            style={{
              width: `${Math.random() * 4 + 2}px`,
              height: `${Math.random() * 4 + 2}px`,
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 5}s`,
              animationDuration: `${Math.random() * 10 + 5}s`
            }}
          />
        ))}
      </div>

      <div className="relative z-10 flex flex-col items-center justify-center w-full h-full max-w-6xl px-4 py-8">
        
        {/* Pack Stage */}
        {(stage === "holding" || stage === "opening") && (
          <div 
            onClick={handlePackClick}
            className={`group relative cursor-pointer select-none transition-all duration-700 ease-out transform
              ${stage === "opening" ? "scale-150 rotate-[720deg] opacity-0 blur-2xl" : "hover:scale-105 active:scale-95"}
            `}
          >
            {/* Ambient pack glow */}
            <div className="absolute -inset-10 bg-gradient-to-r from-sky-500 via-indigo-600 to-purple-500 opacity-20 blur-[100px] group-hover:opacity-40 transition-opacity" />
            
            {/* Pack Image */}
            <div className="relative h-[550px] w-[380px] rounded-[40px] shadow-[0_0_80px_rgba(0,0,0,0.8)] overflow-hidden ring-1 ring-white/20 p-2 bg-slate-900">
               <img 
                 src="/pack-booster.png" 
                 alt="Booster Pack" 
                 className="w-full h-full object-cover rounded-[32px]"
               />
               
               <div className="absolute inset-0 pointer-events-none bg-gradient-to-tr from-white/10 via-transparent to-transparent mix-blend-overlay" />
               
               <div className="absolute bottom-12 left-0 right-0 text-center">
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-black/60 px-4 py-2 backdrop-blur-xl">
                    <span className="text-xs font-black uppercase tracking-[0.3em] text-white animate-pulse">Click to Reveal</span>
                  </div>
               </div>
            </div>
          </div>
        )}

        {/* Revealed Cards Stage */}
        {stage === "revealing" && currentCard && (
          <div 
            onClick={handleCardClick}
            className={`relative flex flex-col items-center justify-center w-full max-w-lg transition-all duration-500 transform
              ${animatingCard ? "opacity-0 -translate-y-20 rotate-1 scale-95" : "opacity-100 translate-y-0 scale-100"}
            `}
          >
            <div className="mb-8 text-center animate-fade-in">
               <h2 className="text-sm font-black tracking-[0.4em] text-sky-400 uppercase mb-2">Pack Unlocked</h2>
               <p className="text-xs font-medium text-slate-400 tracking-widest uppercase">
                 Card <span className="text-white text-base mx-1">{currentCardIndex + 1}</span> of {cards.length}
               </p>
            </div>

            <div className="group relative w-full aspect-[2/3] max-h-[700px] overflow-hidden rounded-[3rem] border border-white/30 bg-slate-900 shadow-[0_30px_100px_-20px_rgba(0,0,0,1)] ring-1 ring-white/10 transition-transform duration-500 cursor-pointer hover:scale-[1.02]">
              
              {currentCard.imageUrl ? (
                <div className="absolute inset-0">
                   <img 
                      src={currentCard.imageUrl} 
                      alt={currentCard.name}
                      className="w-full h-full object-cover transition-transform duration-[20s] group-hover:scale-125"
                   />
                   <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent opacity-90" />
                   <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-transparent opacity-60" />
                </div>
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-slate-800 to-slate-950 flex items-center justify-center">
                   <span className="text-slate-600 font-bold uppercase tracking-widest">No Card Image</span>
                </div>
              )}

              <div className="absolute inset-0 opacity-0 group-hover:opacity-40 pointer-events-none mix-blend-color-dodge animate-shine-slow bg-[linear-gradient(110deg,transparent_30%,rgba(255,255,255,0.8)_45%,transparent_60%)]" />

              <div className="relative h-full flex flex-col justify-between p-10 z-10">
                 <div className="flex justify-between items-start">
                    <div className="px-4 py-1.5 rounded-full bg-white/10 backdrop-blur-xl border border-white/20 shadow-xl">
                       <span className="text-[10px] font-black uppercase tracking-widest text-white">{currentCard.rarity}</span>
                    </div>
                    <div className="px-4 py-1.5 rounded-full bg-black/40 backdrop-blur-xl border border-white/10">
                       <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wide">{currentCard.cardSet}</span>
                    </div>
                 </div>

                 <div className="flex flex-col items-center">
                    <h3 className="text-4xl text-center font-black text-white mb-6 drop-shadow-[0_10px_10px_rgba(0,0,0,0.8)] leading-tight tracking-tight">
                       {currentCard.name}
                    </h3>
                    
                    <div className="flex flex-col items-center gap-2 group/price transition-all transform hover:scale-110">
                       <div className="inline-flex items-center gap-3 px-8 py-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 backdrop-blur-2xl shadow-[0_0_30px_rgba(16,185,129,0.2)]">
                          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-400">Market Value</span>
                          <span className="text-3xl font-black text-emerald-200">${currentCard.marketValueUsd}</span>
                       </div>
                    </div>
                 </div>
              </div>
            </div>

            <div className="mt-12 text-slate-500 text-xs font-bold uppercase tracking-[0.3em] animate-pulse">
               {currentCardIndex < cards.length - 1 ? "Click to see next" : "Click to finish"}
            </div>
          </div>
        )}

        {/* Summary Stage */}
        {stage === "summary" && (
          <div className="w-full max-w-5xl animate-fade-in flex flex-col h-full overflow-hidden">
             <div className="text-center mb-10 shrink-0">
                <h2 className="text-4xl font-black text-white mb-2 tracking-tight uppercase">Pack Summary</h2>
                <p className="text-slate-400 font-medium tracking-[0.2em] uppercase text-xs">You pulled {cards.length} cards with a total value of</p>
                <div className="mt-4 inline-block px-10 py-4 rounded-3xl bg-emerald-500/10 border border-emerald-500/20 backdrop-blur-3xl shadow-[0_0_50px_rgba(16,185,129,0.2)]">
                   <span className="text-5xl font-black text-emerald-400 tracking-tighter">${totalPrice}</span>
                </div>
             </div>

             <div className="flex-1 overflow-y-auto px-4 custom-scrollbar">
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-6 py-4">
                   {cards.map((card, idx) => (
                      <div 
                        key={`${card.cardId}-${idx}`} 
                        className="group relative aspect-[2/3] rounded-3xl overflow-hidden border border-white/10 bg-slate-900/50 hover:border-white/30 transition-all hover:-translate-y-2 hover:shadow-2xl hover:shadow-black"
                      >
                         {card.imageUrl ? (
                           <img 
                             src={card.imageUrl} 
                             alt={card.name} 
                             className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity"
                           />
                         ) : (
                           <div className="w-full h-full flex items-center justify-center bg-slate-800 text-[10px] uppercase font-bold text-slate-500">No Image</div>
                         )}
                         <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent" />
                         <div className="absolute bottom-4 left-4 right-4 text-left">
                            <p className="text-[10px] font-bold text-white truncate drop-shadow-md">{card.name}</p>
                            <p className="text-xs font-black text-emerald-400 drop-shadow-md">${card.marketValueUsd}</p>
                         </div>
                      </div>
                   ))}
                </div>
             </div>

             <div className="mt-10 mb-6 text-center shrink-0">
                <button 
                  onClick={onClose}
                  className="px-12 py-4 rounded-full bg-white text-slate-950 font-black uppercase tracking-widest hover:scale-105 active:scale-95 transition-all shadow-[0_10px_30px_rgba(255,255,255,0.2)]"
                >
                   Collect & Close
                </button>
             </div>
          </div>
        )}

      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes float {
          0%, 100% { transform: translateY(0) translateX(0); }
          25% { transform: translateY(-20px) translateX(10px); }
          50% { transform: translateY(-10px) translateX(-20px); }
          75% { transform: translateY(15px) translateX(5px); }
        }
        @keyframes shine-slow {
          0% { transform: translateX(-150%) skewX(-15deg); }
          100% { transform: translateX(150%) skewX(-15deg); }
        }
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-float {
          animation: float linear infinite;
        }
        .animate-shine-slow {
          animation: shine-slow 8s infinite ease-in-out;
        }
        .animate-fade-in {
          animation: fade-in 0.8s forwards cubic-bezier(0, 0, 0.2, 1);
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(255,255,255,0.05);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.2);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255,255,255,0.3);
        }
      `}} />
    </div>
  );
}
