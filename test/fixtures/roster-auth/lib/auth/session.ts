import jwt from 'jsonwebtoken';
import Stripe from 'stripe';
export const sign = jwt.sign;
export const stripe = new Stripe('k');
