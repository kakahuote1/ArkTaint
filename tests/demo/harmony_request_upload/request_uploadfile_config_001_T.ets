import request from "@ohos.request";

export function request_uploadfile_config_001_T(userInput: string): void {
    const uploadConfig = {
        url: userInput,
        method: "PUT",
        files: [
            {
                filename: "avatar.jpg",
                name: "file",
                uri: "internal://cache/avatar.jpg",
                type: "image/jpeg"
            }
        ],
        data: [
            {
                name: "token",
                value: "safe"
            }
        ]
    };
    request.uploadFile({}, uploadConfig);
}
