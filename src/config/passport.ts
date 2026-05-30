import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { User, type IUser } from "../models/user.js";

// Configure passport-local strategy for email-only login
passport.use(
  new LocalStrategy(
    {
      usernameField: "email",
      passwordField: "password",
    },
    async (email, password, done) => {
      try {
        const identifier = email.trim().toLowerCase();

        // Find user by email only
        const user = await User.findOne({ email: identifier });

        if (!user) {
          return done(null, false, { message: "Invalid email or password." });
        }

        if (!user.isActive) {
          return done(null, false, { message: "This user account is suspended." });
        }

        // Compare password using custom utility
        const isMatch = user.comparePassword(password);
        if (!isMatch) {
          return done(null, false, { message: "Invalid email or password." });
        }

        return done(null, user);
      } catch (error) {
        return done(error);
      }
    }
  )
);

// Serialize user ID to the session cookie
passport.serializeUser((user, done) => {
  done(null, (user as unknown as IUser)._id);
});

// Deserialize user object by ID from the session cookie
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user as Express.User | null);
  } catch (error) {
    done(error);
  }
});
