import { Text, View } from "react-native";

type StatusToastProps = {
  message: string;
};

export function StatusToast({ message }: StatusToastProps): JSX.Element {
  return (
    <View>
      <Text>{message}</Text>
    </View>
  );
}
