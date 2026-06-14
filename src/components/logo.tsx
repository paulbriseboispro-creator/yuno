import type React from "react";

export const LogoIcon = (props: React.ComponentProps<"svg">) => (
	<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
		<path
			d="M12 2L4 7v5c0 4.4 3.4 8.5 8 9.5 4.6-1 8-5.1 8-9.5V7L12 2z"
			fill="currentColor"
			opacity="0.15"
		/>
		<path
			d="M8 7l4 5 4-5"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			fill="none"
		/>
		<path
			d="M12 12v5"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
		/>
	</svg>
);

export const Logo = (props: React.ComponentProps<"svg">) => (
	<svg viewBox="0 0 72 24" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
		<path
			d="M8 7l4 5 4-5"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
		<path
			d="M12 12v5"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
		/>
		<text x="28" y="17" fontFamily="Inter, system-ui, sans-serif" fontSize="13" fontWeight="700" fill="currentColor">
			yuno
		</text>
	</svg>
);
