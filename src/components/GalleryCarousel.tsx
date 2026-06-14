import { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface GalleryCarouselProps {
  images: string[];
  venueName: string;
}

export function GalleryCarousel({ images, venueName }: GalleryCarouselProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);

  if (images.length === 0) return null;

  const scroll = (direction: 'left' | 'right') => {
    if (!scrollRef.current) return;
    const scrollAmount = scrollRef.current.clientWidth * 0.8;
    scrollRef.current.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    });
  };

  // Mouse drag handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!scrollRef.current) return;
    setIsDragging(true);
    setStartX(e.pageX - scrollRef.current.offsetLeft);
    setScrollLeft(scrollRef.current.scrollLeft);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !scrollRef.current) return;
    e.preventDefault();
    const x = e.pageX - scrollRef.current.offsetLeft;
    const walk = (x - startX) * 1.5;
    scrollRef.current.scrollLeft = scrollLeft - walk;
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleMouseLeave = () => {
    setIsDragging(false);
  };

  return (
    <div className="relative group">
      {/* Dark glass container */}
      <div className="bg-gradient-to-br from-black/50 to-black/30 backdrop-blur-xl rounded-2xl border border-white/10 p-5 overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
        {/* Scroll container */}
        <div
          ref={scrollRef}
          className={`flex gap-4 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-hide ${
            isDragging ? 'cursor-grabbing' : 'cursor-grab'
          }`}
          style={{
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
        >
          {images.map((url, idx) => (
            <div
              key={idx}
              className="flex-shrink-0 w-[80vw] sm:w-[300px] md:w-[340px] snap-center"
            >
              <div className="relative aspect-[4/3] rounded-xl overflow-hidden group/image">
                {/* Glow effect behind image */}
                <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-transparent opacity-0 group-hover/image:opacity-100 transition-opacity duration-500 blur-xl -z-10 scale-110" />

                {/* Image container with border */}
                <div className="relative h-full rounded-xl overflow-hidden border border-white/10 shadow-[0_4px_20px_rgba(0,0,0,0.5)] group-hover/image:shadow-[0_8px_30px_rgba(200,30,60,0.3)] transition-shadow duration-500">
                  <img
                    src={url}
                    alt={`${venueName} - ${idx + 1}`}
                    className="w-full h-full object-cover transition-transform duration-700 group-hover/image:scale-110 pointer-events-none select-none"
                    draggable={false}
                    loading="lazy"
                  />

                  {/* Subtle overlay gradient */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 group-hover/image:opacity-100 transition-opacity duration-500" />
                </div>

                {/* Image counter badge */}
                <div className="absolute bottom-3 right-3 px-2.5 py-1 bg-black/60 backdrop-blur-md rounded-full text-xs text-white/80 font-medium border border-white/10">
                  {idx + 1}/{images.length}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Left Arrow */}
      <button
        onClick={() => scroll('left')}
        className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/70 backdrop-blur-md border border-white/20 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-all duration-300 hover:bg-primary hover:border-primary hover:scale-110 shadow-lg z-10"
        aria-label="Précédent"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>

      {/* Right Arrow */}
      <button
        onClick={() => scroll('right')}
        className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/70 backdrop-blur-md border border-white/20 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-all duration-300 hover:bg-primary hover:border-primary hover:scale-110 shadow-lg z-10"
        aria-label="Suivant"
      >
        <ChevronRight className="w-5 h-5" />
      </button>
    </div>
  );
}
