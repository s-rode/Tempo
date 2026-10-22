import { motion } from 'framer-motion'

const Spinner = () => (
  <motion.div
    className="w-5 h-5 border-2 border-muted-foreground border-t-background rounded-full"
    animate={{ rotate: 360 }}
    transition={{
      duration: 1,
      repeat: Infinity,
      ease: 'linear'
    }}
  />
)

export default Spinner
