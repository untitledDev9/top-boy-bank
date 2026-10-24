import Account from '../models/Account';

const generateAccountNumber = async (): Promise<string> => {
  let accountNumber: string;
  let exists: any = true;

  while (exists) {
    // Generate a realistic 10-digit account number
    const rand = Math.floor(1000000000 + Math.random() * 9000000000);
    accountNumber = rand.toString();
    exists = await Account.findOne({ account_number: accountNumber });
  }

  return accountNumber!;
};

export default generateAccountNumber;
