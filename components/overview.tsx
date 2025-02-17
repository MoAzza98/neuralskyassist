import { motion } from 'framer-motion';
import Link from 'next/link';

import { MessageIcon, VercelIcon } from './icons';

export const Overview = () => {
  return (
    <motion.div
      key="overview"
      className="max-w-3xl mx-auto md:mt-20"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ delay: 0.5 }}
    >
      <div className="rounded-xl p-6 flex flex-col gap-8 leading-relaxed text-center max-w-xl">
        <p className="flex flex-row justify-center gap-4 items-center">
          <img src="https://i.postimg.cc/2yKZ9M5B/placeholderlogowhite.png" alt="NeuralSky" className="w-20 h-15" />
        </p>
        <p>
          Welcome to NeuralSky, your new AI-powered assistant, designed to help you manage tasks, schedule meetings, and provide insights, all in one place.
        </p>
        <p>
          What should we work on today?
        </p>
      </div>
    </motion.div>
  );
};
